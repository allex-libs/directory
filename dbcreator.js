var Path = require('path');

function createHandler(execlib, util) {
  'use strict';
  var lib = execlib.lib,
    q = lib.q,
    FileOperation = require('./fileoperationcreator')(execlib,util),
    readerFactory = require('./readers')(execlib,FileOperation,util),
    writerFactory = require('./writers')(execlib,FileOperation);

  function FileQ(database, name, path) {
    lib.Fifo.call(this);
    var fq = database.get(name);
    if(fq){
      return fq;
    }
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
    var writer = writerFactory(this.name, this.path, options, defer);
    this.handleWriter(writer);
    return writer.openDefer.promise;
  };
  FileQ.prototype.handleReader = function (reader) {
    console.log('FileQ', this.name, 'should handleReader');
    if (this.writePromise) {
      console.log('q-ing');
      this.push({item:reader,type:'reader'});
    }else{
      console.log('letting');
      this.activeReaders++;
      reader.defer.promise.then(this.readerDown.bind(this));
      reader.go();
    }
  };
  FileQ.prototype.handleWriter = function (writer) {
    if (this.writePromise) {
      this.push({item:writer,type:'writer'});
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
    this.database.changed.fire(this.name, null, null);
  };
  FileQ.prototype.finalizeWriterDown = function (originalfs, newfstats) {
    this.database.changed.fire(this.name, originalfs, newfstats);
    this.writePromise = null;
    this.handleQ();
  };
  FileQ.prototype.handleQ = function () {
    console.log(this.name, 'time for next', this.length);
    if (this.length < 1) {
      this.destroy();
      return;
    }
    var j = this.pop();
    console.log(this.name, 'it is a', j.type);
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
