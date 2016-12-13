(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
ALLEX.execSuite.libRegistry.register('allex_directorylib',require('./index')(ALLEX));

},{"./index":5}],2:[function(require,module,exports){
function dataGeneratorRegistryIntroducer(execlib){
  'use strict';
  var lib = execlib.lib,
    q = lib.q,
    execSuite = execlib.execSuite,
    dataGeneratorRegistry = execSuite.dataGeneratorRegistry;
  if(dataGeneratorRegistry){
    return;
  }
  execSuite.dataGeneratorRegistry = new execSuite.RegistryBase();
}

module.exports = dataGeneratorRegistryIntroducer;

},{}],3:[function(require,module,exports){
(function (process){
var Path = require('path');

function createHandler(execlib, util) {
  'use strict';
  var lib = execlib.lib,
    q = lib.q,
    FileOperation = require('./fileoperationcreator')(execlib,util),
    readerFactory = require('./readers')(execlib,FileOperation,util),
    writerFactory = require('./writers')(execlib,FileOperation),
    _fqid=0;

  function FileQ(database, name, path) {
    var fq = database.get(name);
    if(fq){
      return fq;
    }
    lib.Fifo.call(this);
    this._id = ++_fqid;
    this.database = database;
    this.name = name;
    this.path = path;
    this.writePromise = null;
    this.activeReaders = 0;
    database.add(name,this);
  }
  lib.inherit(FileQ,lib.Fifo);
  FileQ.prototype.destroy = function () {
    //console.log('FileQ', this.name, 'dying, associated database', this.database.rootpath, this.database.closingDefer ? 'should die as well' : 'will keep on living');
    //console.log('FileQ', this._id, this.name, 'dying');
    if (this.length) {
      throw new lib.Error('FILEQ_STILL_NOT_EMPTY');
    }
    this.database.remove(this.name);
    this.activeReaders = null;
    this.writePromise = null;
    this.path = null;
    this.name = null;
    if (this.database.closingDefer) {
      this.database.destroy(); //and let database's destroy deal with it
    }
    this.database = null;
    lib.Fifo.prototype.destroy.call(this);
  };
  FileQ.prototype.read = function (options, defer) {
    //console.log(this.name, this.name ? 'live' : 'dead', 'with length of', this.length, 'going to read');
    defer = defer || q.defer();
    this.handleReader(readerFactory(this.name, this.path, options, defer));
    return defer.promise;
  };
  FileQ.prototype.stepread = function (options, defer) {
    defer = defer || q.defer();
    options = options || {};
    options.stepping = true;
    var reader = readerFactory(this.name, this.path, options, defer);
    this.handleReader(reader);
    return reader;
  };
  FileQ.prototype.write = function (options, defer) {
    if (!this.database) {
      throw new lib.Error('ALREADY_DEAD');
    }
    var writer = writerFactory(this.name, this.path, options, defer);
    this.handleWriter(writer);
    return writer.openDefer.promise;
  };
  FileQ.prototype.handleReader = function (reader) {
    //console.log('FileQ', this.name, 'should handleReader');
    if (this.writePromise) {
      //console.log('q-ing');
      this.push({item:reader,type:'reader'});
    }else{
      //console.log('letting');
      this.activeReaders++;
      reader.defer.promise.then(
        this.readerDown.bind(this),
        this.readerDown.bind(this)
      );
      reader.go();
    }
  };
  FileQ.prototype.handleWriter = function (writer) {
    //console.log('FileQ', this.name, this._id, 'handleWriter, already has writer', !!this.writePromise);
    if (this.writePromise || this.activeReaders > 0) {
      this.push({item:writer,type:'writer'});
      //console.log('now length is', this.length);
    }else{
      this.writePromise = writer.defer.promise;
      if (!(this.writePromise && this.writePromise.then)) {
        console.log('what the @! is writer defer?', writer.defer);
        process.exit(1);
      }
      this.writePromise.then(
        this.writerDown.bind(this),
        this.writerDown.bind(this),
        this.writerWorks.bind(this)
      );
      //console.log('now length is', this.length);
      writer.go();
    }
  };
  FileQ.prototype.readerDown = function () {
    this.activeReaders--;
    this.handleQ();
  };
  FileQ.prototype.writerDown = function (result) {
    if (result) {
      var d = q.defer();
      util.FStats(this.path, d);
      d.promise.done(
        this.finalizeWriterDown.bind(this, result)
      );
    } else {
      this.finalizeWriterDown(result);
    }
  };
  FileQ.prototype.writerWorks = function (chunk) {
    //console.log('FileQ', this.name, this._id, 'writerWorks');
    this.database.changed.fire(this.name, null, null);
  };
  FileQ.prototype.finalizeWriterDown = function (originalfs, newfstats) {
    //console.log('FileQ', this.name, this._id, 'finalizeWriterDown');
    this.database.changed.fire(this.name, originalfs, newfstats);
    this.writePromise = null;
    this.handleQ();
  };
  FileQ.prototype.handleQ = function () {
    //console.log(this.name, 'time for next', this.length);
    if (this.activeReaders < 1) {
      if (this.length > 0) {
        this.pop(this.drainer.bind(this));
        return;
      } else {
        if (!this.writePromise) {
          this.destroy();
        }
      }
    }
  };
  FileQ.prototype.drainer = function (j) {
    //console.log(this.name, 'it is a', j.type);
    switch (j.type) {
      case 'reader':
        return this.handleReader(j.item);
      case 'writer':
        return this.handleWriter(j.item);
      default:
        lib.runNext(this.handleQ.bind(this));
        break;
    }
  };

  function FileDataBase(rootpath){
    lib.Map.call(this);
    this.rootpath = rootpath;
    this.closingDefer = null;
    this.changed = new lib.HookCollection();
  }
  lib.inherit(FileDataBase,lib.Map);
  FileDataBase.prototype.destroy = function () {
    if(this.closingDefer) {
      if(this.count){
        if (this.closingDefer.notify) {
          this.closingDefer.notify(this.count);
        }
        return;
      }
      if (this.closingDefer.resolve) {
        this.closingDefer.resolve(true);
      }
    }
    if (this.changed) {
      this.changed.destruct();
    }
    this.changed = null;
    this.closingDefer = null;
    this.count = null;
    this.rootpath = null;
    lib.Map.prototype.destroy.call(this);
    //console.log('FileDataBase destroying');
  };
  FileDataBase.prototype.begin = function (txnpath) {
    var txnid = lib.uid();
    return new FileDataBaseTxn(txnid, txnpath,this);
  };
  FileDataBase.prototype.read = function (name, options, defer) {
    if(this.closingDefer){
      if(defer){
        defer.resolve(false);
      }
      return;
    }
    return this.fileQ(name).read(options, defer);
  };
  FileDataBase.prototype.stepread = function (name, options, defer) {
    if(this.closingDefer){
      if(defer){
        defer.resolve(false);
      }
      return;
    }
    options = options || {};
    options.stepping = true;
    return this.fileQ(name).stepread(options, defer);
  };
  FileDataBase.prototype.write = function (name, options, defer) {
    if(this.closingDefer){
      if(defer){
        defer.resolve(false);
      }
      return;
    }
    return this.fileQ(name).write(options,defer);
  };
  FileDataBase.prototype.create = function (name, creatoroptions, defer) {
    //creatoroptions: {
    //  modulename: ...,
    //  propertyhash: {
    //    ...
    //  }
    //}
    if (!creatoroptions) {
      defer.reject(new lib.Error('NO_CREATOR_OPTIONS'));
      return;
    }
    if (!creatoroptions.modulename) {
      defer.reject(new lib.Error('NO_MODULENAME_IN_CREATOR_OPTIONS', 'creatoroptions miss the modulename property'));
      return;
    }
    if (!creatoroptions.propertyhash) {
      defer.reject(new lib.Error('NO_PROPERTYHASH_IN_CREATOR_OPTIONS', 'creatoroptions miss the propertyhash property'));
      return;
    }
    execlib.execSuite.dataGeneratorRegistry.spawn(creatoroptions.modulename, creatoroptions.propertyhash).done(
      this.onDataGenerator.bind(this, name, defer),
      defer.reject.bind(defer)
    );
  };
  FileDataBase.prototype.onDataGenerator = function (name, defer, generator) {
  };
  FileDataBase.prototype.close = function (defer) {
    this.closingDefer = defer || true;
    if (this.count<1) {
      this.destroy();
    }
  };
  FileDataBase.prototype.fileQ = function (name) {
    return new FileQ(this, name, util.pathForFilename(this.rootpath,name));
  };
  FileDataBase.prototype.commit = lib.dummyFunc;

  function FileDataBaseTxn(id, path, db) {
    this.id = id;
    this.path = path;
    this.parentDB = db;
    FileDataBase.call(this, this.parentDB.rootpath+'_'+id);
    this.parentDB.add('txn:'+this.id);
  }
  lib.inherit(FileDataBaseTxn, FileDataBase);
  FileDataBaseTxn.prototype.commit = FileDataBase.prototype.close; //just terminology
  FileDataBaseTxn.prototype.destroy = function () {
    //console.log('FileDataBaseTxn destroying', this);
    FileDataBase.prototype.destroy.call(this);
    if (this.rootpath === null) {
      this.postMortem();
    }
  };
  FileDataBase.prototype.postMortem = function () {
    var d = q.defer();
    this.parentDB.write(this.path, {txndirname: this.parentDB.rootpath+'_'+this.id}, d);
    d.promise.done(
      this.onTxnDirDone.bind(this)
    );
  };
  FileDataBase.prototype.onTxnDirDone = function () {
    this.parentDB.remove('txn:'+this.id);
    if (this.parentDB.closingDefer) {
      this.parentDB.destroy();
    }
    this.id = null;
    this.parentDB = null;
  };
  FileDataBase.prototype.metaPath = function (filepath) {
    return Path.join(Path.dirname(filepath),'.meta',Path.basename(filepath));
  };
  function allWriter(data, writer) {
    writer.writeAll(data);
  }
  FileDataBase.prototype.writeToFileName = function (filename, parserinfo, data, defer) {
    defer = defer || q.defer();
    if (data === null) {
      //just touch the file...
      /*
      console.log('Y data null?');
      defer.reject(new lib.Error('WILL_NOT_WRITE_EMPTY_FILE','fs touch not supported'));
      return;
      */
    }
    this.write(filename, parserinfo, defer).then(allWriter.bind(null, data));
    return defer.promise;
  };
  FileDataBase.prototype.writeFileMeta = function (filename, metadata, defer) {
    return this.writeToFileName(this.metaPath(filename), {modulename: 'allex_jsonparser'}, metadata);
  };

  return FileDataBase;
}

module.exports = createHandler;

}).call(this,require('_process'))
},{"./fileoperationcreator":4,"./readers":8,"./writers":10,"_process":18,"path":17}],4:[function(require,module,exports){
var fs = require('fs');
function createFileOperation(execlib, util) {
  'use strict';
  var lib = execlib.lib,
    q = lib.q;

  //TODO: it's still unclear if 
  //this.openDefer should be rejected in case
  //FileOperation gets destroyed without opening
  //the file...
  function FileOperation(name, path, defer) {
    if (!defer.promise) {
      console.trace();
      console.log(defer);
      throw "YOU THINK THIS IS A DEFER?@!";
    }
    this.originalFS = null;
    this.name = name;
    this.path = path;
    this.defer = defer;
    this.result = null;
    this.error = null;
    this.active = false;
    this.fh = null;
    this.openDefer = q.defer();
    var destroyer = this.destroy.bind(this);
    defer.promise.then(destroyer, destroyer);
  };
  FileOperation.prototype.destroy = function () {
    this.openDefer = null;
    if(this.fh){
      this.close();
      return;
    }
    this.fh = null;
    if (this.active === null) {
      return;
    }
    if(this.defer){
      if(this.error){
        this.defer.reject(this.error);
      }else{
        this.defer.resolve(this.result);
      }
    }
    this.active = null;
    this.error = null;
    this.result = null;
    this.defer = null;
    this.path = null;
    this.name = null;
    this.originalFS = null;
  };
  FileOperation.prototype.setOriginalFS = function (d, nameofinterest, defaultvalue, fs){
    //console.log('setting originalFS; will read', nameofinterest, 'later');
    this.originalFS = fs;
    if (nameofinterest) {
      if(lib.isString(nameofinterest)) {
        //console.log('from',fs,'it is', fs ? fs[nameofinterest] : 'N/A','(', defaultvalue, ')');
        d.resolve(fs ? fs[nameofinterest] : defaultvalue);
      }
      if(lib.isFunction(nameofinterest)) {
        d.resolve(fs ? nameofinterest(fs) : defaultvalue);
      }
    } else {
      d.resolve();
    }
  };
  FileOperation.prototype.size = function () {
    var d = q.defer(), ud = q.defer();
    if(!this.originalFS){
      //console.log('fetching originalFS');
      util.FStats(this.path,ud);
      ud.promise.done(
        this.setOriginalFS.bind(this, d, 'size', 0),
        d.reject.bind(d)
      );
    } else {
      //console.log('returning originalFS.size', this.originalFS.size);
      return q(this.originalFS.size);
    }
    return d.promise;
  };
  FileOperation.prototype.type = function () {
    var d = q.defer(), ud = q.defer();
    if(!this.originalFS){
      util.FStats(this.path,ud);
      ud.promise.done(
        this.setOriginalFS.bind(this, d, util.typeFromStats, ''),
        d.reject.bind(d)
      );
    } else {
      return util.typeFromStats(this.originalFS);
    }
    return d.promise;
  };
  FileOperation.prototype.notify = function(obj){
    if(!this.defer){
      return;
    }
    this.defer.notify(obj);
  };
  FileOperation.prototype.fail = function(reason){
    if(!this.defer){
      return;
    }
    this.error = reason;
    this.close();
  };
  FileOperation.prototype.announceOpen = function (fh) {
    if(this.isopen){
      return;
    }
    this.fh = fh;
    this.openDefer.resolve(this);
  };
  FileOperation.prototype.open = function () {
    fs.open(this.path,this.openMode,this.onOpen.bind(this));
  };
  FileOperation.prototype.onOpen = function (err, fh) {
    if(err){
      this.fail(err);
    }else{
      this.announceOpen(fh);
    }
  };
  FileOperation.prototype.close = function () {
    if(this.fh){
      fs.close(this.fh,this.onClosed.bind(this));
    }else{
      this.destroy();
    }
  };
  FileOperation.prototype.onClosed = function (e) {
    if (e) {
      console.trace();
      console.error(e.stack);
      console.error(e);
      this.error = e;
    }
    this.fh = null;
    this.destroy();
  };

  return FileOperation;
}

module.exports = createFileOperation;

},{"fs":12}],5:[function(require,module,exports){
function createFileApi(execlib){
  'use strict';
  try {
  var util = require('./util')(execlib);
  require('./parserregistryintroducer')(execlib);
  require('./datageneratorregistryintroducer')(execlib);

  return {
    DataBase: require('./dbcreator')(execlib, util),
    util: util
  };
  } catch (e) {
    console.log(e.stack);
    console.log(e);
  }
}

module.exports = createFileApi;

},{"./datageneratorregistryintroducer":2,"./dbcreator":3,"./parserregistryintroducer":7,"./util":9}],6:[function(require,module,exports){
(function (process){
var path = require('path');
var fs = require('fs');
var _0777 = parseInt('0777', 8);

module.exports = mkdirP.mkdirp = mkdirP.mkdirP = mkdirP;

function mkdirP (p, opts, f, made) {
    if (typeof opts === 'function') {
        f = opts;
        opts = {};
    }
    else if (!opts || typeof opts !== 'object') {
        opts = { mode: opts };
    }
    
    var mode = opts.mode;
    var xfs = opts.fs || fs;
    
    if (mode === undefined) {
        mode = _0777 & (~process.umask());
    }
    if (!made) made = null;
    
    var cb = f || function () {};
    p = path.resolve(p);
    
    xfs.mkdir(p, mode, function (er) {
        if (!er) {
            made = made || p;
            return cb(null, made);
        }
        switch (er.code) {
            case 'ENOENT':
                mkdirP(path.dirname(p), opts, function (er, made) {
                    if (er) cb(er, made);
                    else mkdirP(p, opts, cb, made);
                });
                break;

            // In the case of any other error, just see if there's a dir
            // there already.  If so, then hooray!  If not, then something
            // is borked.
            default:
                xfs.stat(p, function (er2, stat) {
                    // if the stat fails, then that's super weird.
                    // let the original error be the failure reason.
                    if (er2 || !stat.isDirectory()) cb(er, made)
                    else cb(null, made);
                });
                break;
        }
    });
}

mkdirP.sync = function sync (p, opts, made) {
    if (!opts || typeof opts !== 'object') {
        opts = { mode: opts };
    }
    
    var mode = opts.mode;
    var xfs = opts.fs || fs;
    
    if (mode === undefined) {
        mode = _0777 & (~process.umask());
    }
    if (!made) made = null;

    p = path.resolve(p);

    try {
        xfs.mkdirSync(p, mode);
        made = made || p;
    }
    catch (err0) {
        switch (err0.code) {
            case 'ENOENT' :
                made = sync(path.dirname(p), opts, made);
                sync(p, opts, made);
                break;

            // In the case of any other error, just see if there's a dir
            // there already.  If so, then hooray!  If not, then something
            // is borked.
            default:
                var stat;
                try {
                    stat = xfs.statSync(p);
                }
                catch (err1) {
                    throw err0;
                }
                if (!stat.isDirectory()) throw err0;
                break;
        }
    }

    return made;
};

}).call(this,require('_process'))
},{"_process":18,"fs":12,"path":17}],7:[function(require,module,exports){
function parserRegistryIntroducer(execlib){
  'use strict';
  var lib = execlib.lib,
    q = lib.q,
    execSuite = execlib.execSuite,
    parserRegistry = execSuite.parserRegistry;
  if(parserRegistry){
    return;
  }
  execSuite.parserRegistry = new execSuite.RegistryBase();
}

module.exports = parserRegistryIntroducer;

},{}],8:[function(require,module,exports){
(function (Buffer){
var fs = require('fs'),
  Path = require('path');

function createReaders(execlib,FileOperation,util) {
  'use strict';
  var lib = execlib.lib,
    q = lib.q;

  function FileReader(name, path, defer) {
    FileOperation.call(this, name, path, defer);
  }
  lib.inherit(FileReader,FileOperation);

  FileReader.prototype.read = function (startfrom, quantityorbuffer, defer) {
    var size, buffer;
    if(quantityorbuffer instanceof Buffer){
      buffer = quantityorbuffer;
      size = buffer.length;
    }
    if ('number' === typeof quantityorbuffer) {
      size = quantityorbuffer;
      buffer = new Buffer(size);
    }
    if(!buffer){
      return this.readWhole(startfrom, defer);
    }
    defer = defer || q.defer();
    if(!('number' === typeof startfrom || startfrom instanceof Number)) {
      startfrom = null;
    }
    //console.log('reading',size,'bytes for buffer of size', buffer.length);
    fs.read(this.fh, buffer, 0, size, startfrom, this._onBufferRead.bind(this, defer));
    return defer.promise;
  };
  FileReader.prototype._onBufferRead = function (defer, err, bytesread, buffer) {
    if (err) {
      defer.reject(err);
      this.fail(err);
      return;
    }
    if (bytesread !== buffer.length) {
      defer.notify(buffer.slice(0, bytesread));
    } else {
      defer.notify(buffer);
    }
    defer.resolve(bytesread);
  };

  FileReader.prototype.readWhole = function (startfrom, defer) {
    defer = defer || q.defer();
    this.size().done(this.onSizeForReadWhole.bind(this, startfrom, defer));
    return defer.promise;
  };
  FileReader.prototype.onSizeForReadWhole = function (startfrom, defer, size) { 
    if(!this.openDefer){
      defer.reject(new lib.Error('ALREADY_CLOSED','File is already closed'));
      return;
    }
    this.openDefer.promise.then(this.onOpenWithSizeForReadWhole.bind(this, startfrom, defer, size));
    this.open();
  };
  FileReader.prototype.onOpenWithSizeForReadWhole = function (startfrom, defer, size) {
    startfrom = startfrom || 0;
    this.read(startfrom, size-startfrom, defer);
  };

  FileReader.prototype.readInFixedChunks = function (recordsize, processfn) { 
    this.size().done(this.onSizeForFixedChunks.bind(this, recordsize, processfn));
  };
  FileReader.prototype.onSizeForFixedChunks = function (recordsize, processfn, size) {
    //console.log('onSizeForFixedChunks', size, recordsize);
    if ((size - headersize - footersize) % recordsize) {
      this.fail(new lib.Error('RECORD_SIZE_MISMATCH',this.name+' is of size '+size+' record of size '+recordsize+' cannot fit'));
      return;
    }
    this.openDefer.promise.then(this.readChunk.bind(this, new Buffer(recordsize), processfn));
    this.open();
  };
  FileReader.prototype.readChunk = function (buffer, processfn) {
    fs.read(this.fh, buffer, 0, buffer.length, null, this.onChunkRead.bind(this, processfn));
  };
  FileReader.prototype.onChunkRead = function (processfn, err, bytesread, buffer) {
    var processresult;
    if (bytesread === buffer.length) {
      processresult = processfn(buffer);
      //attempt to support possible async parsing; for now the parsing is synchronous
      if (processresult && 'function' === typeof processresult.then) {
        processresult.then(this.readChunk.bind(this, buffer, processfn));
      } else {
        this.readChunk(buffer,processfn);
      }
    } else {
      processfn();
    }
  };
  FileReader.prototype.openMode = 'r';

  function FileTransmitter(name, path, options, defer) {
    FileReader.call(this, name, path, defer);
    this.options = options;
    this.buffer = null;
  }
  lib.inherit(FileTransmitter,FileReader);
  FileTransmitter.prototype.destroy = function () {
    this.buffer = null;
    this.options = null;
    FileReader.prototype.destroy.call(this);
  };
  FileTransmitter.prototype.go = function () {
    this.result = 0;
    this.size().then(
      this.onSizeForTransmit.bind(this)
    );
  };
  FileTransmitter.prototype.onSizeForTransmit = function () {
    if (!this.openDefer) {
      return;
    }
    this.openDefer.promise.then(
      this.step.bind(this)
    );
    this.open();
  }
  FileTransmitter.prototype.step = function () {
    if (!(this.originalFS && this.originalFS.size)) {
      return;
    }
    var offset = (this.options.start||0)+this.result,
      size;
    if (this.options.quantity) {
     size = Math.min(this.options.quantity-this.result, 0xffb0);
    } else {
     size = Math.min(this.originalFS.size-offset, 0xffb0);
    }
    if (size < 1) {
      this.destroy();
      return;
    }
    //console.log('size', this.originalFS.size, 'read from', offset, 'to read', size, 'with options', this.options);
    this.read(offset, size).then(
      //this.optionallyStep.bind(this),
      this.step.bind(this),
      this.fail.bind(this),
      this.onChunk.bind(this)
    );
  };
  /*
  FileTransmitter.prototype.optionallyStep = function () {
    if (!this.options.stepping) {
      this.step();
    }
  };
  */
  FileTransmitter.prototype.onChunk = function (chunk) {
    this.result += chunk.length;
    this.notify(chunk);
  };

  function ParsedFileReader(name, path, options, defer) {
    FileReader.call(this, name, path, defer);
    this.options = options;
  }
  lib.inherit(ParsedFileReader,FileReader);
  ParsedFileReader.prototype.destroy = function () {
    this.options = null;
    FileReader.prototype.destroy.call(this);
  };
  ParsedFileReader.prototype.go = function () {
    if(this.active){
      return;
    }
    this.active = true;
    if (this.options.parserinstance) {
      this.onParser(this.options.parserinstance);
    } else {
      if(this.options.parsermodulename === '*'){
      }else{
        execlib.execSuite.parserRegistry.spawn(this.options.parsermodulename, this.options.propertyhash).done(
          this.onParser.bind(this),
          this.fail.bind(this)
        );
      }
    }
  };
  ParsedFileReader.prototype.onParser = function (parser) {
    if(lib.defined(parser.recordDelimiter)){
      var delim = parser.recordDelimiter, tord = typeof delim, start, quantity;
      if ('number' === tord) {
        if (!(this.options && this.options.raw)) {
          this.result = 0;
          this.size().done(this.onSizeForParser.bind(this, parser));
        } else {
          parser.destroy(); //parser used only to read recordDelimiter
          start = this.options.hasOwnProperty('startfrom') ? this.options.startfrom * delim : null;
          quantity = this.options.hasOwnProperty('quantity') ? this.options.quantity * delim : null;
          this.openDefer.promise.then(this.onOpenForRawRead.bind(this, start, quantity));
          this.open();
        }
      }
      if (parser.recordDelimiter instanceof Buffer) {
        //console.log('time for readVariableLengthRecords', parser.recordDelimiter);
        this.openDefer.promise.done(this.readVariableLengthRecords.bind(this, parser, {offset:0}));
        this.open();
      }
    }else{
      this.readWhole().done(
        this.onWholeReadDone.bind(this, parser),
        this.fail.bind(this),
        this.onWholeReadData.bind(this, parser)
      );
    }
  };
  ParsedFileReader.prototype.onSizeForParser = function (parser, size) {
    var hrfr = new HRFReader(this, size, parser);
    hrfr.defer.promise.done(
      this.destroy.bind(this),
      this.fail.bind(this)
    );
    hrfr.go();
  };
  ParsedFileReader.prototype.onOpenForRawRead = function (start, quantity) {
    //console.log(this.name, 'onOpenForRawRead', start, quantity);
    this.read(start, quantity).done(
      this.onRawReadDone.bind(this),
      this.fail.bind(this),
      this.notify.bind(this)
    );
  };
  ParsedFileReader.prototype.onWholeReadDone = function (parser, bytesread) {
    parser.destroy();
    this.close();
  };
  ParsedFileReader.prototype.onRawReadDone = function (bytesread) {
    this.result = bytesread;
    this.close();
  };
  ParsedFileReader.prototype.onWholeReadData = function (parser, buff) {
    try {
      this.result = parser.fileToData(buff);
    } catch(e) {
      this.fail(e);
    }
  };
  ParsedFileReader.prototype.readVariableLengthRecords = function (parser, offsetobj) {
    var buff = new Buffer(1050);
    //console.log('reading with offset', offsetobj.offset);
    this.read(offsetobj.offset, buff).done(
      this.onBufferReadForVariableLengthRecord.bind(this, parser, buff, offsetobj)
     );
  };
  ParsedFileReader.prototype.onBufferReadForVariableLengthRecord = function (parser, buff, offsetobj, bytesread) {
    //console.log('csv bytes read', bytesread);
    if (!bytesread) {
      parser.destroy();
      this.result = offsetobj.offset;
      this.close();
      return;
    }
    buff = buff.length === bytesread ? buff : buff.slice(0, bytesread);
    try {
      var records = parser.fileToData(buff);
      //console.log('records', records);
      //console.log(records.length, 'records');
      records.forEach(this.notify.bind(this));
      offsetobj.offset+=bytesread;
      this.readVariableLengthRecords(parser, offsetobj);
    } catch (e) {
      this.fail(e);
    }
  };

  function HRFReader(filereader, filesize, parser) {
    //console.log('new HRFReader', filesize);
    lib.AsyncJob.call(this);
    this.reader = filereader;
    this.parser = parser;
    this.filesize = filesize;
    this.header = parser.headerLength ? new Buffer(parser.headerLength) : null;
    this.record = parser.recordDelimiter ? new Buffer(parser.recordDelimiter) : null;
    this.footer = parser.footerLength ? new Buffer(parser.footerLength) : null;
    this.recordstoread = ~~((this.filesize - this.headerLength() - this.footerLength()) / this.parser.recordDelimiter);
    //console.log(this.reader.name, 'recordstoread', this.recordstoread);
  }
  lib.inherit(HRFReader, lib.AsyncJob);
  HRFReader.prototype.destroy = function () {
    if (this.parser) {
      this.parser.destroy();
    }
    this.recordstoread = null;
    this.footer = null;
    this.record = null;
    this.header = null;
    this.filesize = null;
    this.parser = null;
    this.reader = null;
    lib.AsyncJob.prototype.destroy.call(this);
  };
  HRFReader.prototype.proc = function () {
    if (!this.sizesOK()) {
      console.error(this.reader.name+' is of size '+this.filesize+' record of size '+this.parser.recordDelimiter+' cannot fit');
      this.fail(new lib.Error('RECORD_SIZE_MISMATCH',this.name+' is of size '+this.size+' record of size '+this.parser.recordDelimiter+' cannot fit'));
      return;
    }
    this.reader.openDefer.promise.done(
      this.read.bind(this),
      this.fail.bind(this)
    );
    this.reader.open();
  }
  HRFReader.prototype.headerLength = function () {
    return this.parser.headerLength || 0;
  };
  HRFReader.prototype.footerLength = function () {
    return this.parser.footerLength || 0;
  };
  HRFReader.prototype.sizesOK = function () {
    return ((this.filesize - (this.headerLength()) - (this.footerLength())) % this.parser.recordDelimiter) === 0;
  };
  HRFReader.prototype.read = function () {
    var buff;
    if (this.header) {
      buff = this.header;
    } else if (this.record){
      buff = this.record;
    } else if (this.footer){
      buff = this.footer;
    }
    if (!buff) {
      this.destroy();
    } else {
      fs.read(this.reader.fh, buff, 0, buff.length, null, this.onRead.bind(this));
    }
  };
  HRFReader.prototype.onRead = function (err, bytesread, buffer) {
    if (buffer === this.header) {
      this.header = null;
      this.parser.onHeader(buffer);
      //set this.record to new Buffer(this.parser.recordDelimiter)
    } else if (buffer === this.record) {
      this.recordstoread --;
      if (this.recordstoread < 1) {
        this.record = null;
      }
      this.onRecord(buffer);
      if (!this.record) {
        this.finalize();
      }
    } else if (buffer === this.footer) {
      this.footer = null;
      this.parser.onFooter(buffer);
    }
    if (!(this.reader.result%100)) {
      lib.runNext(this.read.bind(this), 100);
    } else {
      this.read();
    }
  };
  HRFReader.prototype.onRecord = function (record) {
    var rec;
    //console.log('onRecord', record);
    if (!record) {
      this.finalize();
      this.reader.close();
      this.destroy();
      return;
    }
    try {
      rec = this.parser.fileToData(record);
      if(lib.defined(rec)){
        this.reader.result++;
        this.reader.notify(rec);
      }
    } catch (e) {
      //console.log('ERROR in parsing record',record,':',e);
      this.reader.fail(e);
    }
  };
  HRFReader.prototype.finalize = function () {
    var rec = this.parser.finalize();
    if (lib.defined(rec)) {
      this.reader.result++;
      this.reader.notify(rec);
    }
  };

  /*
   * options: {
   *   filecontents: { //options
   *     parsermodulename: '*' or a real parser modulename,
   *     parsers: {
   *       modulename: modulepropertyhash for spawning
   *     }
   *   },
   *   filestats: ['filebasename', 'filename', 'fileext', 'filetype', 'created', 'lastmodified'],
   *   metastats: [stringorfetcher],
   *   files: ['filename1', ..., 'filenameN'], //whitelist
   *   filetypes: ['f', 'd'], //whitelist
   * }
   */
  function DirReader(name, path, options, defer) {
    FileReader.call(this, name, path, defer);
    this.filecount = 0;
    this.options = options;
    this.parserInfo = {
      waiting: false,
      instance: null
    };
    if (this.options.filecontents) {
      if (this.options.filecontents.parsermodulename) {
        if (this.options.filecontents.parsermodulename !== '*') {
          execlib.execSuite.parserRegistry.spawn(this.options.filecontents.parsermodulename, this.options.filecontents.propertyhash).done(
            this.onParserInstantiated.bind(this),
            this.fail.bind(this)
          );
        }
      }
    }
  }
  lib.inherit(DirReader, FileReader);
  DirReader.prototype.destroy = function () {
    this.options = null;
    this.filecount = null;
    FileReader.prototype.destroy.call(this);
  };
  DirReader.prototype.go = function () {
    //console.log('going for', this.path, 'with current parserInfo', this.parserInfo, 'and options', this.options);
    if(this.options.needparsing && this.options.filecontents.parsermodulename !== '*') {
      if (!this.parserInfo.instance) {
        this.parserInfo.waiting = true;
        return;
      } else {
        this.parserInfo.waiting = false;
      }
    }
    this.type().then(
      this.onType.bind(this)
    );
  };
  DirReader.prototype.onParserInstantiated = function (parser) {
    //console.log('parser instantiated', parser, 'current parserInfo', this.parserInfo);
    this.parserInfo.instance = parser;
    if (this.parserInfo.waiting) {
      this.go();
    }
  };
  DirReader.prototype.onType = function(type){
    if (type !== 'd') {
      this.fail(new lib.Error('WRONG_FILE_TYPE',this.name+' is not a directory'));
      return;
    }
    fs.readdir(this.path, this.onListing.bind(this));
  };
  DirReader.prototype.onListing = function (err, list) {
    if (err) {
      this.fail(err);
    } else {
      this.result = 0;
      if (list.length) {
        this.filecount = list.length;
        this.processFileList(list);
      } else {
        this.destroy();
      }
    }
  };
  DirReader.prototype.processFileList = function (filelist) {
    var filename;
    if (filelist.length) {
      filename = filelist.pop();
      //console.log('processFileName', filename, filelist, 'left');
      this.processFileName(filename).done(
        this.processSuccess.bind(this,filelist,filename),
        this.fail.bind(this)
      );
    } else {
      this.destroy();
    }
  };
  DirReader.prototype.processSuccess = function (filelist, filename, result) {
    if (result) {
      this.oneDone();
    } else {
      this.oneFailed();
    }
    this.processFileList(filelist);
  };
  DirReader.prototype.checkDone = function () {
    if(this.filecount===this.result){
      //console.log('DirReader destroying because', this.filecount, '===', this.result);
      this.destroy();
    };
  };
  DirReader.prototype.oneDone = function () {
    //console.log(this.name,'oneDone');
    this.result ++;
    //console.log('this.result is now', this.result);
    this.checkDone();
  };
  DirReader.prototype.oneFailed = function () {
    //console.log(this.name,'oneFailed');
    this.filecount --;
    //console.log('this.filecount is now', this.filecount);
    this.checkDone();
  };
  DirReader.prototype.processFileName = function (filename) {
    var d, rd, metareader;
    if (!this.options) {
      return q(false);
    }
    if (this.options.files && this.options.files.indexOf(filename) < 0) {
      return q(false);
    }
    //console.log(this.name, 'deciding wether to read .meta, this.parserInfo', this.parserInfo, 'this.options', this.options);
    d = q.defer();
    if (this.needMeta()) {
      rd = q.defer();
      //console.log('metareader for', filename);
      metareader = readerFactory(Path.join('.meta', filename), Path.join(this.path, '.meta', filename), {parsermodulename: 'allex_jsonparser'}, rd);
      rd.promise.done(
        this.onMeta.bind(this,d,filename),
        d.resolve.bind(d, false)
      );
      metareader.go();
    } else {
      this.checkFStats(d, filename);
    }
    return d.promise;
  };
  DirReader.prototype.needParsing = function () {
    return this.options && this.options.needparsing && 
      (
        this.options.filecontents.parsermodulename === '*' ||
        this.options.filecontents.parsers
      );
  };
  DirReader.prototype.needMeta = function () {
    //console.log('needMeta?', this.options);
    return this.options.metastats || this.needParsing();
  };
  function modulefinder(findobj, moduleitem) {
    if(findobj.modulename === moduleitem.modulename){
      findobj.found = moduleitem;
      return true;
    }
  }
  function fillMetaInfo(metainfo, metaresult, metaname){
    if (lib.isString(metaname)) {
      metaresult[metaname] = metainfo[metaname];
    } else {
      metaresult[metaname.dest] = lib.readPropertyFromDotDelimitedString(metainfo, metaname.src);
    }
  }
  DirReader.prototype.onMeta = function (defer, filename, meta) {
    //console.log(this.name, 'onMeta', filename, meta, require('util').inspect(this.options, {depth:null}));
    if (!meta) {
      defer.resolve(false);
      return;
    }
    if (!this.options) {
      defer.resolve(false);
      return;
    }
    if (this.options.filecontents && this.options.filecontents.parsers) {
      //console.log('looking for', meta.parserinfo.modulename, 'in', this.options.filecontents.parsers);
      var parserfound = this.options.filecontents.parsers[meta.parserinfo.modulename];
      //console.log('found', parserfound);
      if (!parserfound) {
        defer.resolve(false);
        return;
      }
      //console.log('found', parserfound);
      meta.parserinfo.propertyhash = lib.extend({}, meta.parserinfo.propertyhash, parserfound.propertyhash);
    }
    if (this.needParsing()) {
      if (!meta.parserinfo) {
        defer.resolve(false);
        return;
      }
      //console.log(filename, 'meta.parserinfo', meta.parserinfo, 'this.options.filecontents', this.options.filecontents);
      execlib.execSuite.parserRegistry.spawn(meta.parserinfo.modulename, meta.parserinfo.propertyhash).done(
        this.onMetaParser.bind(this, defer, filename),
        defer.resolve.bind(defer,false)
      );
    } else {
      var metainfo = {};
      this.options.metastats.forEach(fillMetaInfo.bind(null, meta, metainfo));
      this.options.metainfo = metainfo;
      this.checkFStats(defer, filename);
    }
  };
  DirReader.prototype.onMetaParser = function (defer, filename, parser) {
    this.parserInfo.instance = parser;
    this.checkFStats(defer, filename);
  };
  DirReader.prototype.checkFStats = function (defer, filename) {
    if (this.needsFStats()) {
      fs.lstat(Path.join(this.path,filename), this.onFileStats.bind(this,defer,filename));
    } else {
      this.reportFile(filename, {defer:defer});
    }
  };
  DirReader.prototype.needsFStats = function () {
    return this.options.filestats || this.options.filetypes;
  };
  DirReader.prototype.reportFile = function (filename, reportobj) {
    //console.log('reportFile', filename, this.parserInfo);
    if (this.options.needparsing) {
      var d = q.defer(),
        parser = readerFactory(filename, Path.join(this.path,filename), {parserinstance:this.parserInfo.instance}, d);
      d.promise.done(
        //reportobj.defer.resolve.bind(reportobj.defer,true),
        this.onParsedFile.bind(this, reportobj),
        this.fail.bind(this),
        this.onParsedRecord.bind(this, reportobj.data || {})
      );
      parser.go();
    } else {
      var data = lib.extend(reportobj.data, this.options.metainfo);
      //console.log(filename, '=>', data);
      this.notify(data || filename);
      reportobj.defer.resolve(true);
    }
  };
  DirReader.prototype.onParsedFile = function (reportobj) {
    this.parserInfo.instance.destroy();
    this.parserInfo.instance = null;
    reportobj.defer.resolve(true);
  };
  DirReader.prototype.onParsedRecord = function (statsobj, parsedrecord) {
    //console.log('notifying', parsedrecord);
    lib.traverse(statsobj,function(statsitem, statsname){
      parsedrecord[statsname] = statsitem;
    });
    this.notify(parsedrecord);
  };
  DirReader.prototype.onFileStats = function (defer, filename, err, fstats, stats) {
    stats = stats || {};
    if (this.options.filetypes) {
      if (lib.isArray(this.options.filetypes) && this.options.filetypes.indexOf(util.typeFromStats(fstats))<0) {
        defer.resolve(false);
        return;
      }
    }
    this.options.filestats.forEach(this.populateStats.bind(this,filename,fstats,stats));
    this.reportFile(filename,{defer: defer, data: stats});
  };
  DirReader.prototype.populateStats = function (filename, fstats, stats, statskey) {
    var mn = 'extract_'+statskey, 
      m = this[mn];
    if ('function' === typeof m){
      stats[statskey] = m.call(this, filename, fstats);
    }/* else {
      console.log('Method',mn,'does not exist to populate',statskey,'of filestats');
    }*/
  };
  DirReader.prototype.extract_filename = function (filename, fstats) {
    return filename;
  };
  DirReader.prototype.extract_filebasename = function (filename, fstats) {
    return Path.basename(filename,Path.extname(filename));
  };
  DirReader.prototype.extract_fileext = function (filename, fstats) {
    var ret = Path.extname(filename);
    return ret.charAt(0)==='.' ? ret.substring(1) : ret;
  };
  DirReader.prototype.extract_filetype = function (filename, fstats) {
    return util.typeFromStats(fstats);
  };
  DirReader.prototype.extract_created = function (filename, fstats) {
    return fstats.birthtime;
  };
  DirReader.prototype.extract_lastmodified = function (filename, fstats) {
    return fstats.mtime;
  };
  DirReader.prototype.extract_filesize = function (filename, fstats) {
    return fstats.size;
  };


  function readerFactory(name, path, options, defer) {
    if(options.parsermodulename || options.parserinstance){
      return new ParsedFileReader(name, path, options, defer);
    }
    if(options.traverse){
      return new DirReader(name, path, options, defer);
    }
    return new FileTransmitter(name, path, options, defer);
  }

  return readerFactory;
}

module.exports = createReaders;

}).call(this,require("buffer").Buffer)
},{"buffer":13,"fs":12,"path":17}],9:[function(require,module,exports){
(function (process){
var fs = require('fs'),
    Path = require('path'),
    mkdirp = require('mkdirp');

function createUtil(execlib){
  'use strict';
  var lib = execlib.lib;

  function surePath(path) {
    if (lib.isArray(path)) {
      return Path.join.apply(Path, path);
    }
    return path;
  }

  function satisfyPath(path){
    var p;
    path = surePath(path);
    p = Path.isAbsolute(path) ? path : Path.join(process.cwd(),path);
    mkdirp.sync(path);
  }
  function pathForFilename(path,filename){
    var ret = Path.join(surePath(path),filename);
    satisfyPath(Path.dirname(ret));
    return ret;
  }
  function typeFromStats(stats){
    if(stats.isFile()){
      return 'f';
    }
    if(stats.isDirectory()){
      return 'd';
    }
    if(stats.isBlockDevice()){
      return 'b';
    }
    if(stats.isCharacterDevice()){
      return 'c';
    }
    if(stats.isSymbolicLink()){
      return 'l';
    }
    if(stats.isSocket()){
      return 's';
    }
    if(stats.isFIFO()){
      return 'n'; //named pipe
    }
  }
  function fileType(filepath,defer){
    if(defer){
      fs.lstat(filepath,function(err,fstats){
        if(err){
          defer.resolve(0);
        }else{
          defer.resolve(typeFromStats(fstats));
        }
      });
    }else{
      try{
        var fstats = fs.lstatSync(filepath);
        return typeFromStats(fstats);
      }
      catch(e){
        return '';
      }
    }
  }
  function fileSize(filepath,defer){
    if(defer){
      fs.lstat(filepath,function(err,fstats){
        if(err){
          defer.resolve(0);
        }else{
          defer.resolve(fstats.size);
        }
      });
    }else{
      try{
        var fstats = fs.lstatSync(filepath);
        return fstats.size;
      }
      catch(e){
        return 0;
      }
    }
  }

  function FStats(filepath,defer) {
    if(defer){
      fs.lstat(filepath,function(err,fstats){
        if(err){
          defer.resolve(null);
        }else{
          defer.resolve(fstats);
        }
      });
    }else{
      try{
        var fstats = fs.lstatSync(filepath);
        return fstats;
      }
      catch(e){
        return null;
      }
    }
  }

  return {
    satisfyPath: satisfyPath,
    pathForFilename: pathForFilename,
    fileSize: fileSize,
    fileType: fileType,
    FStats: FStats,
    typeFromStats: typeFromStats
  };
}

module.exports = createUtil;

}).call(this,require('_process'))
},{"_process":18,"fs":12,"mkdirp":6,"path":17}],10:[function(require,module,exports){
(function (Buffer){
var fs = require('fs'),
  child_process = require('child_process'),
  Path = require('path');
function createWriters(execlib,FileOperation) {
  'use strict';
  var lib = execlib.lib,
    q = lib.q,
    _fwid = 0;

  function FileWriter(name, path, defer, append){
    FileOperation.call(this, name, path, defer);
    this._id = ++_fwid;
    this.openMode = append ? 'a' : 'w';
    this.iswriting = false;
    this.q = new lib.Fifo();
  }
  lib.inherit(FileWriter,FileOperation);
  FileWriter.prototype.destroy = function () {
    if (this.isopen === null) {
      return;
    }
    if(!this.q){
      return;
    }
    //TODO: this.q needs to be cleaned with all the defers within handled properly
    this.q.destroy();
    this.q = null;
    this.iswriting = null;
    this.openMode = null;
    this.result = this.originalFS;
    FileOperation.prototype.destroy.call(this);
  };
  FileWriter.prototype.go = function () {
    if (this.active) {
      return;
    }
    this.size().done(
      this.readyToOpen.bind(this)
    );
  };
  FileWriter.prototype.readyToOpen = function () {
    if(!this.active){
      this.active = true;
      this.open();
    }
  };
  FileWriter.prototype.write = function (chunk, defer) {
    defer = defer || q.defer();
    if(this.isopen === false){
      defer.reject(new lib.Error('NOT_OPEN',this.name+' is not opened yet'));
      return defer.promise;
    }
    if(this.iswriting===null){
      defer.reject(new lib.Error('ALREADY_CLOSED','File is already closed'));
      return defer.promise;
    }
    if(this.iswriting){
      this.q.push([chunk, defer]);
    }else{
      this.iswriting = true;
      this._performWriting(chunk, defer, {written:0});
    }
    return defer.promise;
  };
  FileWriter.prototype._performWriting = function (chunk, defer, writtenobj) {
    //console.log(this.name, 'writing', chunk.length);
    if (!this.fh) {
      console.trace();
      console.log('cannot write without my filehandle');
      return;
    }
    if(Buffer.isBuffer(chunk)){
      fs.write(this.fh, chunk, 0, chunk.length, null, this.onBufferWritten.bind(this, defer, writtenobj));
    }else if (chunk === null) {
      this.finishWriting(defer, 0);
    }else{
      fs.write(this.fh, chunk, null, 'utf8', this.onStringWritten.bind(this, defer));
    }
  };
  FileWriter.prototype.onBufferWritten = function (defer, writtenobj, err, written, buffer) {
    if (err) {
      console.error(err, 'when writing', writtenobj, 'on', this);
      defer.reject(err);
      this.fail(err);
    } else {
      writtenobj.written += written;
      if (written === buffer.length) {
        this.finishWriting(defer, writtenobj.written);
      } else {
        this._performWriting(buffer.slice(written), defer, writtenobj);
      }
    }
  };
  FileWriter.prototype.onStringWritten = function (defer, err, written, string) {
    if (err) {
      defer.reject(err);
      this.fail(err);
    } else {
      this.finishWriting(defer, written);
    }
  };
  function popone (fw, pending) {
    if(pending){
      fw.iswriting = true;
      fw._performWriting(pending[0],pending[1],{written:0});
    }
  }
  FileWriter.prototype.finishWriting = function (defer, writtenbytes) {
    this.iswriting = false;
    //console.log('resolving', defer, 'with', writtenbytes);
    defer.resolve(writtenbytes);
    this.q.pop(popone.bind(null, this));
  };
  FileWriter.prototype.writeAll = function (data) {
    this.write(data).then(this.onAllWritten.bind(this, data));
  };
  FileWriter.prototype.onAllWritten = function (object) {
    //console.log('FileWriter', this._id, 'onAllWritten', object);
    this.result = object;
    this.close();
  };

  function RawFileWriter(name, path, defer, append){
    FileWriter.call(this, name, path, defer, append);
    this.result = 0;
  }
  lib.inherit(RawFileWriter, FileWriter);
  RawFileWriter.prototype.write = function (chunk, defer) {
    defer = defer || q.defer();
    FileWriter.prototype.write.call(this, chunk, defer).done(
      this.onWritten.bind(this)
    )
    return defer.promise;
  };
  RawFileWriter.prototype.onWritten = function (bytes) {
    this.result += bytes;
    this.notify(this.result);
  };

  function ParsedFileWriter(name, path, parsermodulename, parserpropertyhash, defer, append) {
    FileWriter.call(this, name, path, defer, append);
    this.modulename = parsermodulename;
    this.prophash = parserpropertyhash;
    this.parser = null;
    this.recordsWritten = 0;
  }
  lib.inherit(ParsedFileWriter,FileWriter);
  ParsedFileWriter.prototype.destroy = function () {
    this.recordsWritten = null;
    if (this.parser) {
      this.parser.destroy();
    }
    this.parser = null;
    this.prophash = null;
    this.modulename = null;
    FileWriter.prototype.destroy.call(this);
  };
  ParsedFileWriter.prototype.go = function () {
    if(this.active){
      return;
    }
    this.active = true;
    execlib.execSuite.parserRegistry.spawn(this.modulename, this.prophash).done(
      this.onParser.bind(this),
      this.fail.bind(this)
    );
  };
  ParsedFileWriter.prototype.onParser = function (parser) {
    this.parser = parser;
    this.open();
  };
  ParsedFileWriter.prototype.write = function (object, defer) {
    var chunk;
    defer = defer || q.defer();
    if(!object){
      defer.reject(new lib.Error('NO_OBJECT_TO_WRITE'));
    }else{
      chunk = this.parser.dataToFile(object);
      if(chunk){
        defer.promise.done(
          this.onWritten.bind(this)
        );
        FileWriter.prototype.write.call(this, chunk, defer);
      }else{
        defer.reject(new lib.Error('INVALID_UNPARSING', JSON.stringify(object)));
      }
    }
    return defer.promise;
  };
  ParsedFileWriter.prototype.onWritten = function () {
    this.notify(++this.recordsWritten);
    //console.log('ParsedFileWriter', this._id, 'notifying recordsWritten', this.recordsWritten);
  };

  function PerFileParsedFileWriter(name, path, parsermodulename, parserpropertyhash, defer, append) {
    ParsedFileWriter.call(this,name, path, parsermodulename, parserpropertyhash, defer, append);
  }
  lib.inherit(PerFileParsedFileWriter, ParsedFileWriter);
  PerFileParsedFileWriter.prototype.go = function () {
    //console.log('should write .parserinfo');
    ParsedFileWriter.prototype.go.call(this);
  };

  function TxnCommiter(txndirname, name, path, defer) {
    FileOperation.call(this, name, path, defer);
    //console.log('new TxnCommiter', txndirname, name, path, '=>', this);
    this.txndirname = txndirname;
    this.affectedfilepaths = null;
  }
  lib.inherit(TxnCommiter, FileOperation);
  TxnCommiter.prototype.destroy = function () {
    this.affectedfilepaths = null;
    this.txndirname = null;
    FileOperation.prototype.destroy.call(this);
  };
  TxnCommiter.prototype.go = function () {
    child_process.exec('mkdir -p '+Path.dirname(this.path), this.onMkDir.bind(this));
    //child_process.exec('find '+this.txndirname+' -type f', this.onFindResults.bind(this));
  };
  /*
  TxnCommiter.prototype.onFindResults = function(err, stdout, stderr) {
    if (err) {
      this.fail(err);
      return;
    }
    var results = stdout.trim().split("\n");
    this.result = results.length;
    this.affectedfilepaths = results.map(Path.relative.bind(Path,this.txndirname));
    console.log('cp -rp '+Path.join(this.txndirname, this.name)+' '+this.path);
    child_process.exec('cp -rp '+Path.join(this.txndirname, this.name)+' '+this.path, this.onCpRp.bind(this));
  };
  */
  TxnCommiter.prototype.onMkDir = function (err, stdio, stderr) {
    if (this.name === '.') {
      child_process.exec('cp -rp '+this.txndirname+'/* '+this.path, this.onCpRp.bind(this));
    } else {
      child_process.exec('cp -rp '+Path.join(this.txndirname, this.name)+' '+Path.dirname(this.path), this.onCpRp.bind(this));
    }
  };
  TxnCommiter.prototype.onCpRp = function () {
    child_process.exec('rm -rf '+this.txndirname, this.onRmRf.bind(this));
  };
  TxnCommiter.prototype.onRmRf = function () {
    //console.log('onRmRf');
    this.destroy();
  };

  function writerFactory(name, path, options, defer) {
    if (options.txndirname) {
      //console.log('for',name,'returning new TxnCommiter');
      return new TxnCommiter(options.txndirname, name, path, defer);
    }
    if (options.modulename){
      if (options.typed) {
        //console.log('for',name,'returning new ParsedFileWriter');
        return new ParsedFileWriter(name, path, options.modulename, options.propertyhash, defer, options.append);
      } else {
        //console.log('for',name,'returning new PerFileParsedFileWriter');
        return new PerFileParsedFileWriter(name, path, options.modulename, options.propertyhash, defer, options.append);
      }
    }
    //console.log('for',name,'returning new RawFileWriter');
    return new RawFileWriter(name, path, defer, options.append);
  }
  return writerFactory;
}

module.exports = createWriters;

}).call(this,{"isBuffer":require("../../../../../../../../lib/node_modules/allex-toolbox-dev/node_modules/is-buffer/index.js")})
},{"../../../../../../../../lib/node_modules/allex-toolbox-dev/node_modules/is-buffer/index.js":15,"child_process":12,"fs":12,"path":17}],11:[function(require,module,exports){
'use strict'

exports.byteLength = byteLength
exports.toByteArray = toByteArray
exports.fromByteArray = fromByteArray

var lookup = []
var revLookup = []
var Arr = typeof Uint8Array !== 'undefined' ? Uint8Array : Array

var code = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
for (var i = 0, len = code.length; i < len; ++i) {
  lookup[i] = code[i]
  revLookup[code.charCodeAt(i)] = i
}

revLookup['-'.charCodeAt(0)] = 62
revLookup['_'.charCodeAt(0)] = 63

function placeHoldersCount (b64) {
  var len = b64.length
  if (len % 4 > 0) {
    throw new Error('Invalid string. Length must be a multiple of 4')
  }

  // the number of equal signs (place holders)
  // if there are two placeholders, than the two characters before it
  // represent one byte
  // if there is only one, then the three characters before it represent 2 bytes
  // this is just a cheap hack to not do indexOf twice
  return b64[len - 2] === '=' ? 2 : b64[len - 1] === '=' ? 1 : 0
}

function byteLength (b64) {
  // base64 is 4/3 + up to two characters of the original data
  return b64.length * 3 / 4 - placeHoldersCount(b64)
}

function toByteArray (b64) {
  var i, j, l, tmp, placeHolders, arr
  var len = b64.length
  placeHolders = placeHoldersCount(b64)

  arr = new Arr(len * 3 / 4 - placeHolders)

  // if there are placeholders, only get up to the last complete 4 chars
  l = placeHolders > 0 ? len - 4 : len

  var L = 0

  for (i = 0, j = 0; i < l; i += 4, j += 3) {
    tmp = (revLookup[b64.charCodeAt(i)] << 18) | (revLookup[b64.charCodeAt(i + 1)] << 12) | (revLookup[b64.charCodeAt(i + 2)] << 6) | revLookup[b64.charCodeAt(i + 3)]
    arr[L++] = (tmp >> 16) & 0xFF
    arr[L++] = (tmp >> 8) & 0xFF
    arr[L++] = tmp & 0xFF
  }

  if (placeHolders === 2) {
    tmp = (revLookup[b64.charCodeAt(i)] << 2) | (revLookup[b64.charCodeAt(i + 1)] >> 4)
    arr[L++] = tmp & 0xFF
  } else if (placeHolders === 1) {
    tmp = (revLookup[b64.charCodeAt(i)] << 10) | (revLookup[b64.charCodeAt(i + 1)] << 4) | (revLookup[b64.charCodeAt(i + 2)] >> 2)
    arr[L++] = (tmp >> 8) & 0xFF
    arr[L++] = tmp & 0xFF
  }

  return arr
}

function tripletToBase64 (num) {
  return lookup[num >> 18 & 0x3F] + lookup[num >> 12 & 0x3F] + lookup[num >> 6 & 0x3F] + lookup[num & 0x3F]
}

function encodeChunk (uint8, start, end) {
  var tmp
  var output = []
  for (var i = start; i < end; i += 3) {
    tmp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
    output.push(tripletToBase64(tmp))
  }
  return output.join('')
}

function fromByteArray (uint8) {
  var tmp
  var len = uint8.length
  var extraBytes = len % 3 // if we have 1 byte left, pad 2 bytes
  var output = ''
  var parts = []
  var maxChunkLength = 16383 // must be multiple of 3

  // go through the array every three bytes, we'll deal with trailing stuff later
  for (var i = 0, len2 = len - extraBytes; i < len2; i += maxChunkLength) {
    parts.push(encodeChunk(uint8, i, (i + maxChunkLength) > len2 ? len2 : (i + maxChunkLength)))
  }

  // pad the end with zeros, but make sure to not forget the extra bytes
  if (extraBytes === 1) {
    tmp = uint8[len - 1]
    output += lookup[tmp >> 2]
    output += lookup[(tmp << 4) & 0x3F]
    output += '=='
  } else if (extraBytes === 2) {
    tmp = (uint8[len - 2] << 8) + (uint8[len - 1])
    output += lookup[tmp >> 10]
    output += lookup[(tmp >> 4) & 0x3F]
    output += lookup[(tmp << 2) & 0x3F]
    output += '='
  }

  parts.push(output)

  return parts.join('')
}

},{}],12:[function(require,module,exports){

},{}],13:[function(require,module,exports){
(function (global){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */
/* eslint-disable no-proto */

'use strict'

var base64 = require('base64-js')
var ieee754 = require('ieee754')
var isArray = require('isarray')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Due to various browser bugs, sometimes the Object implementation will be used even
 * when the browser supports typed arrays.
 *
 * Note:
 *
 *   - Firefox 4-29 lacks support for adding new properties to `Uint8Array` instances,
 *     See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *   - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *   - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *     incorrect length in some situations.

 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they
 * get the Object implementation, which is slower but behaves correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = global.TYPED_ARRAY_SUPPORT !== undefined
  ? global.TYPED_ARRAY_SUPPORT
  : typedArraySupport()

/*
 * Export kMaxLength after typed array support is determined.
 */
exports.kMaxLength = kMaxLength()

function typedArraySupport () {
  try {
    var arr = new Uint8Array(1)
    arr.__proto__ = {__proto__: Uint8Array.prototype, foo: function () { return 42 }}
    return arr.foo() === 42 && // typed array instances can be augmented
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        arr.subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
  } catch (e) {
    return false
  }
}

function kMaxLength () {
  return Buffer.TYPED_ARRAY_SUPPORT
    ? 0x7fffffff
    : 0x3fffffff
}

function createBuffer (that, length) {
  if (kMaxLength() < length) {
    throw new RangeError('Invalid typed array length')
  }
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    that = new Uint8Array(length)
    that.__proto__ = Buffer.prototype
  } else {
    // Fallback: Return an object instance of the Buffer class
    if (that === null) {
      that = new Buffer(length)
    }
    that.length = length
  }

  return that
}

/**
 * The Buffer constructor returns instances of `Uint8Array` that have their
 * prototype changed to `Buffer.prototype`. Furthermore, `Buffer` is a subclass of
 * `Uint8Array`, so the returned instances will have all the node `Buffer` methods
 * and the `Uint8Array` methods. Square bracket notation works as expected -- it
 * returns a single octet.
 *
 * The `Uint8Array` prototype remains unmodified.
 */

function Buffer (arg, encodingOrOffset, length) {
  if (!Buffer.TYPED_ARRAY_SUPPORT && !(this instanceof Buffer)) {
    return new Buffer(arg, encodingOrOffset, length)
  }

  // Common case.
  if (typeof arg === 'number') {
    if (typeof encodingOrOffset === 'string') {
      throw new Error(
        'If encoding is specified then the first argument must be a string'
      )
    }
    return allocUnsafe(this, arg)
  }
  return from(this, arg, encodingOrOffset, length)
}

Buffer.poolSize = 8192 // not used by this implementation

// TODO: Legacy, not needed anymore. Remove in next major version.
Buffer._augment = function (arr) {
  arr.__proto__ = Buffer.prototype
  return arr
}

function from (that, value, encodingOrOffset, length) {
  if (typeof value === 'number') {
    throw new TypeError('"value" argument must not be a number')
  }

  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
    return fromArrayBuffer(that, value, encodingOrOffset, length)
  }

  if (typeof value === 'string') {
    return fromString(that, value, encodingOrOffset)
  }

  return fromObject(that, value)
}

/**
 * Functionally equivalent to Buffer(arg, encoding) but throws a TypeError
 * if value is a number.
 * Buffer.from(str[, encoding])
 * Buffer.from(array)
 * Buffer.from(buffer)
 * Buffer.from(arrayBuffer[, byteOffset[, length]])
 **/
Buffer.from = function (value, encodingOrOffset, length) {
  return from(null, value, encodingOrOffset, length)
}

if (Buffer.TYPED_ARRAY_SUPPORT) {
  Buffer.prototype.__proto__ = Uint8Array.prototype
  Buffer.__proto__ = Uint8Array
  if (typeof Symbol !== 'undefined' && Symbol.species &&
      Buffer[Symbol.species] === Buffer) {
    // Fix subarray() in ES2016. See: https://github.com/feross/buffer/pull/97
    Object.defineProperty(Buffer, Symbol.species, {
      value: null,
      configurable: true
    })
  }
}

function assertSize (size) {
  if (typeof size !== 'number') {
    throw new TypeError('"size" argument must be a number')
  } else if (size < 0) {
    throw new RangeError('"size" argument must not be negative')
  }
}

function alloc (that, size, fill, encoding) {
  assertSize(size)
  if (size <= 0) {
    return createBuffer(that, size)
  }
  if (fill !== undefined) {
    // Only pay attention to encoding if it's a string. This
    // prevents accidentally sending in a number that would
    // be interpretted as a start offset.
    return typeof encoding === 'string'
      ? createBuffer(that, size).fill(fill, encoding)
      : createBuffer(that, size).fill(fill)
  }
  return createBuffer(that, size)
}

/**
 * Creates a new filled Buffer instance.
 * alloc(size[, fill[, encoding]])
 **/
Buffer.alloc = function (size, fill, encoding) {
  return alloc(null, size, fill, encoding)
}

function allocUnsafe (that, size) {
  assertSize(size)
  that = createBuffer(that, size < 0 ? 0 : checked(size) | 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < size; ++i) {
      that[i] = 0
    }
  }
  return that
}

/**
 * Equivalent to Buffer(num), by default creates a non-zero-filled Buffer instance.
 * */
Buffer.allocUnsafe = function (size) {
  return allocUnsafe(null, size)
}
/**
 * Equivalent to SlowBuffer(num), by default creates a non-zero-filled Buffer instance.
 */
Buffer.allocUnsafeSlow = function (size) {
  return allocUnsafe(null, size)
}

function fromString (that, string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') {
    encoding = 'utf8'
  }

  if (!Buffer.isEncoding(encoding)) {
    throw new TypeError('"encoding" must be a valid string encoding')
  }

  var length = byteLength(string, encoding) | 0
  that = createBuffer(that, length)

  var actual = that.write(string, encoding)

  if (actual !== length) {
    // Writing a hex string, for example, that contains invalid characters will
    // cause everything after the first invalid character to be ignored. (e.g.
    // 'abxxcd' will be treated as 'ab')
    that = that.slice(0, actual)
  }

  return that
}

function fromArrayLike (that, array) {
  var length = array.length < 0 ? 0 : checked(array.length) | 0
  that = createBuffer(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

function fromArrayBuffer (that, array, byteOffset, length) {
  array.byteLength // this throws if `array` is not a valid ArrayBuffer

  if (byteOffset < 0 || array.byteLength < byteOffset) {
    throw new RangeError('\'offset\' is out of bounds')
  }

  if (array.byteLength < byteOffset + (length || 0)) {
    throw new RangeError('\'length\' is out of bounds')
  }

  if (byteOffset === undefined && length === undefined) {
    array = new Uint8Array(array)
  } else if (length === undefined) {
    array = new Uint8Array(array, byteOffset)
  } else {
    array = new Uint8Array(array, byteOffset, length)
  }

  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    that = array
    that.__proto__ = Buffer.prototype
  } else {
    // Fallback: Return an object instance of the Buffer class
    that = fromArrayLike(that, array)
  }
  return that
}

function fromObject (that, obj) {
  if (Buffer.isBuffer(obj)) {
    var len = checked(obj.length) | 0
    that = createBuffer(that, len)

    if (that.length === 0) {
      return that
    }

    obj.copy(that, 0, 0, len)
    return that
  }

  if (obj) {
    if ((typeof ArrayBuffer !== 'undefined' &&
        obj.buffer instanceof ArrayBuffer) || 'length' in obj) {
      if (typeof obj.length !== 'number' || isnan(obj.length)) {
        return createBuffer(that, 0)
      }
      return fromArrayLike(that, obj)
    }

    if (obj.type === 'Buffer' && isArray(obj.data)) {
      return fromArrayLike(that, obj.data)
    }
  }

  throw new TypeError('First argument must be a string, Buffer, ArrayBuffer, Array, or array-like object.')
}

function checked (length) {
  // Note: cannot use `length < kMaxLength()` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= kMaxLength()) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + kMaxLength().toString(16) + ' bytes')
  }
  return length | 0
}

function SlowBuffer (length) {
  if (+length != length) { // eslint-disable-line eqeqeq
    length = 0
  }
  return Buffer.alloc(+length)
}

Buffer.isBuffer = function isBuffer (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function compare (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError('Arguments must be Buffers')
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length

  for (var i = 0, len = Math.min(x, y); i < len; ++i) {
    if (a[i] !== b[i]) {
      x = a[i]
      y = b[i]
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'latin1':
    case 'binary':
    case 'base64':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, length) {
  if (!isArray(list)) {
    throw new TypeError('"list" argument must be an Array of Buffers')
  }

  if (list.length === 0) {
    return Buffer.alloc(0)
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; ++i) {
      length += list[i].length
    }
  }

  var buffer = Buffer.allocUnsafe(length)
  var pos = 0
  for (i = 0; i < list.length; ++i) {
    var buf = list[i]
    if (!Buffer.isBuffer(buf)) {
      throw new TypeError('"list" argument must be an Array of Buffers')
    }
    buf.copy(buffer, pos)
    pos += buf.length
  }
  return buffer
}

function byteLength (string, encoding) {
  if (Buffer.isBuffer(string)) {
    return string.length
  }
  if (typeof ArrayBuffer !== 'undefined' && typeof ArrayBuffer.isView === 'function' &&
      (ArrayBuffer.isView(string) || string instanceof ArrayBuffer)) {
    return string.byteLength
  }
  if (typeof string !== 'string') {
    string = '' + string
  }

  var len = string.length
  if (len === 0) return 0

  // Use a for loop to avoid recursion
  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'ascii':
      case 'latin1':
      case 'binary':
        return len
      case 'utf8':
      case 'utf-8':
      case undefined:
        return utf8ToBytes(string).length
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return len * 2
      case 'hex':
        return len >>> 1
      case 'base64':
        return base64ToBytes(string).length
      default:
        if (loweredCase) return utf8ToBytes(string).length // assume utf8
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}
Buffer.byteLength = byteLength

function slowToString (encoding, start, end) {
  var loweredCase = false

  // No need to verify that "this.length <= MAX_UINT32" since it's a read-only
  // property of a typed array.

  // This behaves neither like String nor Uint8Array in that we set start/end
  // to their upper/lower bounds if the value passed is out of range.
  // undefined is handled specially as per ECMA-262 6th Edition,
  // Section 13.3.3.7 Runtime Semantics: KeyedBindingInitialization.
  if (start === undefined || start < 0) {
    start = 0
  }
  // Return early if start > this.length. Done here to prevent potential uint32
  // coercion fail below.
  if (start > this.length) {
    return ''
  }

  if (end === undefined || end > this.length) {
    end = this.length
  }

  if (end <= 0) {
    return ''
  }

  // Force coersion to uint32. This will also coerce falsey/NaN values to 0.
  end >>>= 0
  start >>>= 0

  if (end <= start) {
    return ''
  }

  if (!encoding) encoding = 'utf8'

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'latin1':
      case 'binary':
        return latin1Slice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

// The property is used by `Buffer.isBuffer` and `is-buffer` (in Safari 5-7) to detect
// Buffer instances.
Buffer.prototype._isBuffer = true

function swap (b, n, m) {
  var i = b[n]
  b[n] = b[m]
  b[m] = i
}

Buffer.prototype.swap16 = function swap16 () {
  var len = this.length
  if (len % 2 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 16-bits')
  }
  for (var i = 0; i < len; i += 2) {
    swap(this, i, i + 1)
  }
  return this
}

Buffer.prototype.swap32 = function swap32 () {
  var len = this.length
  if (len % 4 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 32-bits')
  }
  for (var i = 0; i < len; i += 4) {
    swap(this, i, i + 3)
    swap(this, i + 1, i + 2)
  }
  return this
}

Buffer.prototype.swap64 = function swap64 () {
  var len = this.length
  if (len % 8 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 64-bits')
  }
  for (var i = 0; i < len; i += 8) {
    swap(this, i, i + 7)
    swap(this, i + 1, i + 6)
    swap(this, i + 2, i + 5)
    swap(this, i + 3, i + 4)
  }
  return this
}

Buffer.prototype.toString = function toString () {
  var length = this.length | 0
  if (length === 0) return ''
  if (arguments.length === 0) return utf8Slice(this, 0, length)
  return slowToString.apply(this, arguments)
}

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max) str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (target, start, end, thisStart, thisEnd) {
  if (!Buffer.isBuffer(target)) {
    throw new TypeError('Argument must be a Buffer')
  }

  if (start === undefined) {
    start = 0
  }
  if (end === undefined) {
    end = target ? target.length : 0
  }
  if (thisStart === undefined) {
    thisStart = 0
  }
  if (thisEnd === undefined) {
    thisEnd = this.length
  }

  if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
    throw new RangeError('out of range index')
  }

  if (thisStart >= thisEnd && start >= end) {
    return 0
  }
  if (thisStart >= thisEnd) {
    return -1
  }
  if (start >= end) {
    return 1
  }

  start >>>= 0
  end >>>= 0
  thisStart >>>= 0
  thisEnd >>>= 0

  if (this === target) return 0

  var x = thisEnd - thisStart
  var y = end - start
  var len = Math.min(x, y)

  var thisCopy = this.slice(thisStart, thisEnd)
  var targetCopy = target.slice(start, end)

  for (var i = 0; i < len; ++i) {
    if (thisCopy[i] !== targetCopy[i]) {
      x = thisCopy[i]
      y = targetCopy[i]
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

// Finds either the first index of `val` in `buffer` at offset >= `byteOffset`,
// OR the last index of `val` in `buffer` at offset <= `byteOffset`.
//
// Arguments:
// - buffer - a Buffer to search
// - val - a string, Buffer, or number
// - byteOffset - an index into `buffer`; will be clamped to an int32
// - encoding - an optional encoding, relevant is val is a string
// - dir - true for indexOf, false for lastIndexOf
function bidirectionalIndexOf (buffer, val, byteOffset, encoding, dir) {
  // Empty buffer means no match
  if (buffer.length === 0) return -1

  // Normalize byteOffset
  if (typeof byteOffset === 'string') {
    encoding = byteOffset
    byteOffset = 0
  } else if (byteOffset > 0x7fffffff) {
    byteOffset = 0x7fffffff
  } else if (byteOffset < -0x80000000) {
    byteOffset = -0x80000000
  }
  byteOffset = +byteOffset  // Coerce to Number.
  if (isNaN(byteOffset)) {
    // byteOffset: it it's undefined, null, NaN, "foo", etc, search whole buffer
    byteOffset = dir ? 0 : (buffer.length - 1)
  }

  // Normalize byteOffset: negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = buffer.length + byteOffset
  if (byteOffset >= buffer.length) {
    if (dir) return -1
    else byteOffset = buffer.length - 1
  } else if (byteOffset < 0) {
    if (dir) byteOffset = 0
    else return -1
  }

  // Normalize val
  if (typeof val === 'string') {
    val = Buffer.from(val, encoding)
  }

  // Finally, search either indexOf (if dir is true) or lastIndexOf
  if (Buffer.isBuffer(val)) {
    // Special case: looking for empty string/buffer always fails
    if (val.length === 0) {
      return -1
    }
    return arrayIndexOf(buffer, val, byteOffset, encoding, dir)
  } else if (typeof val === 'number') {
    val = val & 0xFF // Search for a byte value [0-255]
    if (Buffer.TYPED_ARRAY_SUPPORT &&
        typeof Uint8Array.prototype.indexOf === 'function') {
      if (dir) {
        return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset)
      } else {
        return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset)
      }
    }
    return arrayIndexOf(buffer, [ val ], byteOffset, encoding, dir)
  }

  throw new TypeError('val must be string, number or Buffer')
}

function arrayIndexOf (arr, val, byteOffset, encoding, dir) {
  var indexSize = 1
  var arrLength = arr.length
  var valLength = val.length

  if (encoding !== undefined) {
    encoding = String(encoding).toLowerCase()
    if (encoding === 'ucs2' || encoding === 'ucs-2' ||
        encoding === 'utf16le' || encoding === 'utf-16le') {
      if (arr.length < 2 || val.length < 2) {
        return -1
      }
      indexSize = 2
      arrLength /= 2
      valLength /= 2
      byteOffset /= 2
    }
  }

  function read (buf, i) {
    if (indexSize === 1) {
      return buf[i]
    } else {
      return buf.readUInt16BE(i * indexSize)
    }
  }

  var i
  if (dir) {
    var foundIndex = -1
    for (i = byteOffset; i < arrLength; i++) {
      if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === valLength) return foundIndex * indexSize
      } else {
        if (foundIndex !== -1) i -= i - foundIndex
        foundIndex = -1
      }
    }
  } else {
    if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength
    for (i = byteOffset; i >= 0; i--) {
      var found = true
      for (var j = 0; j < valLength; j++) {
        if (read(arr, i + j) !== read(val, j)) {
          found = false
          break
        }
      }
      if (found) return i
    }
  }

  return -1
}

Buffer.prototype.includes = function includes (val, byteOffset, encoding) {
  return this.indexOf(val, byteOffset, encoding) !== -1
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, true)
}

Buffer.prototype.lastIndexOf = function lastIndexOf (val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, false)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) throw new TypeError('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; ++i) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(parsed)) return i
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function latin1Write (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8'
    length = this.length
    offset = 0
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset
    length = this.length
    offset = 0
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset | 0
    if (isFinite(length)) {
      length = length | 0
      if (encoding === undefined) encoding = 'utf8'
    } else {
      encoding = length
      length = undefined
    }
  // legacy write(string, encoding, offset, length) - remove in v0.13
  } else {
    throw new Error(
      'Buffer.write(string, encoding, offset[, length]) is no longer supported'
    )
  }

  var remaining = this.length - offset
  if (length === undefined || length > remaining) length = remaining

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('Attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8'

  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'latin1':
      case 'binary':
        return latin1Write(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  end = Math.min(buf.length, end)
  var res = []

  var i = start
  while (i < end) {
    var firstByte = buf[i]
    var codePoint = null
    var bytesPerSequence = (firstByte > 0xEF) ? 4
      : (firstByte > 0xDF) ? 3
      : (firstByte > 0xBF) ? 2
      : 1

    if (i + bytesPerSequence <= end) {
      var secondByte, thirdByte, fourthByte, tempCodePoint

      switch (bytesPerSequence) {
        case 1:
          if (firstByte < 0x80) {
            codePoint = firstByte
          }
          break
        case 2:
          secondByte = buf[i + 1]
          if ((secondByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F)
            if (tempCodePoint > 0x7F) {
              codePoint = tempCodePoint
            }
          }
          break
        case 3:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F)
            if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
              codePoint = tempCodePoint
            }
          }
          break
        case 4:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          fourthByte = buf[i + 3]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F)
            if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
              codePoint = tempCodePoint
            }
          }
      }
    }

    if (codePoint === null) {
      // we did not generate a valid codePoint so insert a
      // replacement char (U+FFFD) and advance only 1 byte
      codePoint = 0xFFFD
      bytesPerSequence = 1
    } else if (codePoint > 0xFFFF) {
      // encode to utf16 (surrogate pair dance)
      codePoint -= 0x10000
      res.push(codePoint >>> 10 & 0x3FF | 0xD800)
      codePoint = 0xDC00 | codePoint & 0x3FF
    }

    res.push(codePoint)
    i += bytesPerSequence
  }

  return decodeCodePointsArray(res)
}

// Based on http://stackoverflow.com/a/22747272/680742, the browser with
// the lowest limit is Chrome, with 0x10000 args.
// We go 1 magnitude less, for safety
var MAX_ARGUMENTS_LENGTH = 0x1000

function decodeCodePointsArray (codePoints) {
  var len = codePoints.length
  if (len <= MAX_ARGUMENTS_LENGTH) {
    return String.fromCharCode.apply(String, codePoints) // avoid extra slice()
  }

  // Decode in chunks to avoid "call stack size exceeded".
  var res = ''
  var i = 0
  while (i < len) {
    res += String.fromCharCode.apply(
      String,
      codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
    )
  }
  return res
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function latin1Slice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; ++i) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    newBuf = this.subarray(start, end)
    newBuf.__proto__ = Buffer.prototype
  } else {
    var sliceLen = end - start
    newBuf = new Buffer(sliceLen, undefined)
    for (var i = 0; i < sliceLen; ++i) {
      newBuf[i] = this[i + start]
    }
  }

  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('"value" argument is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1
    checkInt(this, value, offset, byteLength, maxBytes, 0)
  }

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1
    checkInt(this, value, offset, byteLength, maxBytes, 0)
  }

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  this[offset] = (value & 0xff)
  return offset + 1
}

function objectWriteUInt16 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; ++i) {
    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
      (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = (value & 0xff)
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; ++i) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = 0
  var mul = 1
  var sub = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
      sub = 1
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = byteLength - 1
  var mul = 1
  var sub = 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
      sub = 1
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = (value & 0xff)
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
  if (offset < 0) throw new RangeError('Index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (targetStart >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('sourceStart out of bounds')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start
  var i

  if (this === target && start < targetStart && targetStart < end) {
    // descending copy from end
    for (i = len - 1; i >= 0; --i) {
      target[i + targetStart] = this[i + start]
    }
  } else if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    // ascending copy from start
    for (i = 0; i < len; ++i) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    Uint8Array.prototype.set.call(
      target,
      this.subarray(start, start + len),
      targetStart
    )
  }

  return len
}

// Usage:
//    buffer.fill(number[, offset[, end]])
//    buffer.fill(buffer[, offset[, end]])
//    buffer.fill(string[, offset[, end]][, encoding])
Buffer.prototype.fill = function fill (val, start, end, encoding) {
  // Handle string cases:
  if (typeof val === 'string') {
    if (typeof start === 'string') {
      encoding = start
      start = 0
      end = this.length
    } else if (typeof end === 'string') {
      encoding = end
      end = this.length
    }
    if (val.length === 1) {
      var code = val.charCodeAt(0)
      if (code < 256) {
        val = code
      }
    }
    if (encoding !== undefined && typeof encoding !== 'string') {
      throw new TypeError('encoding must be a string')
    }
    if (typeof encoding === 'string' && !Buffer.isEncoding(encoding)) {
      throw new TypeError('Unknown encoding: ' + encoding)
    }
  } else if (typeof val === 'number') {
    val = val & 255
  }

  // Invalid ranges are not set to a default, so can range check early.
  if (start < 0 || this.length < start || this.length < end) {
    throw new RangeError('Out of range index')
  }

  if (end <= start) {
    return this
  }

  start = start >>> 0
  end = end === undefined ? this.length : end >>> 0

  if (!val) val = 0

  var i
  if (typeof val === 'number') {
    for (i = start; i < end; ++i) {
      this[i] = val
    }
  } else {
    var bytes = Buffer.isBuffer(val)
      ? val
      : utf8ToBytes(new Buffer(val, encoding).toString())
    var len = bytes.length
    for (i = 0; i < end - start; ++i) {
      this[i + start] = bytes[i % len]
    }
  }

  return this
}

// HELPER FUNCTIONS
// ================

var INVALID_BASE64_RE = /[^+\/0-9A-Za-z-_]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []

  for (var i = 0; i < length; ++i) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (!leadSurrogate) {
        // no lead yet
        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // valid lead
        leadSurrogate = codePoint

        continue
      }

      // 2 leads in a row
      if (codePoint < 0xDC00) {
        if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
        leadSurrogate = codePoint
        continue
      }

      // valid surrogate pair
      codePoint = (leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00) + 0x10000
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
    }

    leadSurrogate = null

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x110000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; ++i) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; ++i) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; ++i) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

function isnan (val) {
  return val !== val // eslint-disable-line no-self-compare
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"base64-js":11,"ieee754":14,"isarray":16}],14:[function(require,module,exports){
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var nBits = -7
  var i = isLE ? (nBytes - 1) : 0
  var d = isLE ? -1 : 1
  var s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
  var i = isLE ? 0 : (nBytes - 1)
  var d = isLE ? 1 : -1
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

},{}],15:[function(require,module,exports){
/*!
 * Determine if an object is a Buffer
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */

// The _isBuffer check is for Safari 5-7 support, because it's missing
// Object.prototype.constructor. Remove this eventually
module.exports = function (obj) {
  return obj != null && (isBuffer(obj) || isSlowBuffer(obj) || !!obj._isBuffer)
}

function isBuffer (obj) {
  return !!obj.constructor && typeof obj.constructor.isBuffer === 'function' && obj.constructor.isBuffer(obj)
}

// For Node v0.10 support. Remove this eventually.
function isSlowBuffer (obj) {
  return typeof obj.readFloatLE === 'function' && typeof obj.slice === 'function' && isBuffer(obj.slice(0, 0))
}

},{}],16:[function(require,module,exports){
var toString = {}.toString;

module.exports = Array.isArray || function (arr) {
  return toString.call(arr) == '[object Array]';
};

},{}],17:[function(require,module,exports){
(function (process){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// resolves . and .. elements in a path array with directory names there
// must be no slashes, empty elements, or device names (c:\) in the array
// (so also no leading and trailing slashes - it does not distinguish
// relative and absolute paths)
function normalizeArray(parts, allowAboveRoot) {
  // if the path tries to go above the root, `up` ends up > 0
  var up = 0;
  for (var i = parts.length - 1; i >= 0; i--) {
    var last = parts[i];
    if (last === '.') {
      parts.splice(i, 1);
    } else if (last === '..') {
      parts.splice(i, 1);
      up++;
    } else if (up) {
      parts.splice(i, 1);
      up--;
    }
  }

  // if the path is allowed to go above the root, restore leading ..s
  if (allowAboveRoot) {
    for (; up--; up) {
      parts.unshift('..');
    }
  }

  return parts;
}

// Split a filename into [root, dir, basename, ext], unix version
// 'root' is just a slash, or nothing.
var splitPathRe =
    /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
var splitPath = function(filename) {
  return splitPathRe.exec(filename).slice(1);
};

// path.resolve([from ...], to)
// posix version
exports.resolve = function() {
  var resolvedPath = '',
      resolvedAbsolute = false;

  for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    var path = (i >= 0) ? arguments[i] : process.cwd();

    // Skip empty and invalid entries
    if (typeof path !== 'string') {
      throw new TypeError('Arguments to path.resolve must be strings');
    } else if (!path) {
      continue;
    }

    resolvedPath = path + '/' + resolvedPath;
    resolvedAbsolute = path.charAt(0) === '/';
  }

  // At this point the path should be resolved to a full absolute path, but
  // handle relative paths to be safe (might happen when process.cwd() fails)

  // Normalize the path
  resolvedPath = normalizeArray(filter(resolvedPath.split('/'), function(p) {
    return !!p;
  }), !resolvedAbsolute).join('/');

  return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
};

// path.normalize(path)
// posix version
exports.normalize = function(path) {
  var isAbsolute = exports.isAbsolute(path),
      trailingSlash = substr(path, -1) === '/';

  // Normalize the path
  path = normalizeArray(filter(path.split('/'), function(p) {
    return !!p;
  }), !isAbsolute).join('/');

  if (!path && !isAbsolute) {
    path = '.';
  }
  if (path && trailingSlash) {
    path += '/';
  }

  return (isAbsolute ? '/' : '') + path;
};

// posix version
exports.isAbsolute = function(path) {
  return path.charAt(0) === '/';
};

// posix version
exports.join = function() {
  var paths = Array.prototype.slice.call(arguments, 0);
  return exports.normalize(filter(paths, function(p, index) {
    if (typeof p !== 'string') {
      throw new TypeError('Arguments to path.join must be strings');
    }
    return p;
  }).join('/'));
};


// path.relative(from, to)
// posix version
exports.relative = function(from, to) {
  from = exports.resolve(from).substr(1);
  to = exports.resolve(to).substr(1);

  function trim(arr) {
    var start = 0;
    for (; start < arr.length; start++) {
      if (arr[start] !== '') break;
    }

    var end = arr.length - 1;
    for (; end >= 0; end--) {
      if (arr[end] !== '') break;
    }

    if (start > end) return [];
    return arr.slice(start, end - start + 1);
  }

  var fromParts = trim(from.split('/'));
  var toParts = trim(to.split('/'));

  var length = Math.min(fromParts.length, toParts.length);
  var samePartsLength = length;
  for (var i = 0; i < length; i++) {
    if (fromParts[i] !== toParts[i]) {
      samePartsLength = i;
      break;
    }
  }

  var outputParts = [];
  for (var i = samePartsLength; i < fromParts.length; i++) {
    outputParts.push('..');
  }

  outputParts = outputParts.concat(toParts.slice(samePartsLength));

  return outputParts.join('/');
};

exports.sep = '/';
exports.delimiter = ':';

exports.dirname = function(path) {
  var result = splitPath(path),
      root = result[0],
      dir = result[1];

  if (!root && !dir) {
    // No dirname whatsoever
    return '.';
  }

  if (dir) {
    // It has a dirname, strip trailing slash
    dir = dir.substr(0, dir.length - 1);
  }

  return root + dir;
};


exports.basename = function(path, ext) {
  var f = splitPath(path)[2];
  // TODO: make this comparison case-insensitive on windows?
  if (ext && f.substr(-1 * ext.length) === ext) {
    f = f.substr(0, f.length - ext.length);
  }
  return f;
};


exports.extname = function(path) {
  return splitPath(path)[3];
};

function filter (xs, f) {
    if (xs.filter) return xs.filter(f);
    var res = [];
    for (var i = 0; i < xs.length; i++) {
        if (f(xs[i], i, xs)) res.push(xs[i]);
    }
    return res;
}

// String.prototype.substr - negative index don't work in IE8
var substr = 'ab'.substr(-1) === 'b'
    ? function (str, start, len) { return str.substr(start, len) }
    : function (str, start, len) {
        if (start < 0) start = str.length + start;
        return str.substr(start, len);
    }
;

}).call(this,require('_process'))
},{"_process":18}],18:[function(require,module,exports){
// shim for using process in browser
var process = module.exports = {};

// cached from whatever global is present so that test runners that stub it
// don't break things.  But we need to wrap it in a try catch in case it is
// wrapped in strict mode code which doesn't define any globals.  It's inside a
// function because try/catches deoptimize in certain engines.

var cachedSetTimeout;
var cachedClearTimeout;

function defaultSetTimout() {
    throw new Error('setTimeout has not been defined');
}
function defaultClearTimeout () {
    throw new Error('clearTimeout has not been defined');
}
(function () {
    try {
        if (typeof setTimeout === 'function') {
            cachedSetTimeout = setTimeout;
        } else {
            cachedSetTimeout = defaultSetTimout;
        }
    } catch (e) {
        cachedSetTimeout = defaultSetTimout;
    }
    try {
        if (typeof clearTimeout === 'function') {
            cachedClearTimeout = clearTimeout;
        } else {
            cachedClearTimeout = defaultClearTimeout;
        }
    } catch (e) {
        cachedClearTimeout = defaultClearTimeout;
    }
} ())
function runTimeout(fun) {
    if (cachedSetTimeout === setTimeout) {
        //normal enviroments in sane situations
        return setTimeout(fun, 0);
    }
    // if setTimeout wasn't available but was latter defined
    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
        cachedSetTimeout = setTimeout;
        return setTimeout(fun, 0);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedSetTimeout(fun, 0);
    } catch(e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
            return cachedSetTimeout.call(null, fun, 0);
        } catch(e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
            return cachedSetTimeout.call(this, fun, 0);
        }
    }


}
function runClearTimeout(marker) {
    if (cachedClearTimeout === clearTimeout) {
        //normal enviroments in sane situations
        return clearTimeout(marker);
    }
    // if clearTimeout wasn't available but was latter defined
    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
        cachedClearTimeout = clearTimeout;
        return clearTimeout(marker);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedClearTimeout(marker);
    } catch (e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
            return cachedClearTimeout.call(null, marker);
        } catch (e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
            // Some versions of I.E. have different rules for clearTimeout vs setTimeout
            return cachedClearTimeout.call(this, marker);
        }
    }



}
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    if (!draining || !currentQueue) {
        return;
    }
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = runTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    runClearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        runTimeout(drainQueue);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}]},{},[1]);
