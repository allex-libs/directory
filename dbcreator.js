var Path = require('path');

function createHandler(execlib, util) {
  'use strict';
  var lib = execlib.lib,
    q = lib.q,
    FileOperation = require('./fileoperationcreator')(execlib,util),
    readerFactory = require('./readers')(execlib,FileOperation,util),
    writerFactory = require('./writers')(execlib,FileOperation),
    Dropper = require('./droppercreator')(execlib,FileOperation),
    Mover = require('./movercreator')(execlib,FileOperation),
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
    this.exclusivePromise = null;
    this.nonExclusiveCount = 0;
    this.nonExclusiveDowner = this.nonExclusiveDown.bind(this);
    this.exclusiveDowner = this.exclusiveDown.bind(this);
    this.exclusiveWorkser = this.exclusiveWorks.bind(this);
    this.finalizeExclusiveer = this.finalizeExclusive.bind(this);
    this.handleQItemer = this.handleQItem.bind(this);
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
    this.handleQItemer = null;
    this.finalizeExclusiveer = null;
    this.exclusiveWorkser = null;
    this.exclusiveDowner = null;
    this.nonExclusiveDowner = null;
    this.nonExclusiveCount = null;
    this.exclusivePromise = null;
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
    this.handleQItem(readerFactory(this.name, this.path, options, defer));
    return defer.promise;
  };
  FileQ.prototype.stepread = function (options, defer) {
    defer = defer || q.defer();
    options = options || {};
    options.stepping = true;
    var reader = readerFactory(this.name, this.path, options, defer);
    this.handleQItem(reader);
    return reader;
  };
  FileQ.prototype.write = function (options, defer) {
    if (!this.database) {
      throw new lib.Error('ALREADY_DEAD');
    }
    defer = defer || q.defer();
    var writer = writerFactory(this.name, this.path, options, defer);
    this.handleQItem(writer);
    return writer.openDefer.promise;
  };
  FileQ.prototype.drop = function (defer) {
    var dropper, dropper;
    defer = defer || q.defer();
    dropper = new Dropper(this.name, this.path, defer);
    this.handleQItem(dropper);
    return dropper.openDefer.promise;
  };
  FileQ.prototype.move = function (defer) {
    var mover;
    defer = defer || q.defer();
    mover = new Mover(this.name, this.path, defer);
    this.handleQItem(mover);
    return mover.openDefer.promise;
  };
  FileQ.prototype.handleQItem = function (j) {
    if (j.exclusive) {
      return this.handleExclusive(j);
    }
    return this.handleNonExclusive(j);
  }
  FileQ.prototype.handleNonExclusive = function (nonexc) {
    //console.log('FileQ', this.name, 'should handleNonExclusive');
    if (this.exclusivePromise) {
      //console.log('q-ing');
      this.push(nonexc);
    }else{
      //console.log('letting');
      this.nonExclusiveCount++;
      nonexc.defer.promise.then(
        this.nonExclusiveDowner,
        this.nonExclusiveDowner
      );
      if (!nonexc.go) {
        console.error('dafuq', nonexc.constructor.name, 'has no go', nonexc);
      }
      nonexc.go();
    }
  };
  FileQ.prototype.handleExclusive = function (exc) {
    //console.log('FileQ', this.name, this._id, 'handleExclusive, already has exc', !!this.exclusivePromise);
    if (this.exclusivePromise || this.nonExclusiveCount > 0) {
      this.push(exc);
      //console.log('now length is', this.length);
    }else{
      this.exclusivePromise = exc.defer.promise;
      if (!(this.exclusivePromise && this.exclusivePromise.then)) {
        console.log('what the @! is exc defer?', exc.defer);
        process.exit(1);
      }
      this.exclusivePromise.then(
        this.exclusiveDowner,
        this.exclusiveDowner,
        this.exclusiveWorkser
      );
      //console.log('now length is', this.length);
      exc.go();
    }
  };
  FileQ.prototype.nonExclusiveDown = function () {
    this.nonExclusiveCount--;
    this.handleQ();
  };
  FileQ.prototype.exclusiveDown = function (result) {
    this.fireDataBaseChanged(result).then(
      this.finalizeExclusiveer
    );
  };
  FileQ.prototype.exclusiveWorks = function (chunk) {
    //console.log('FileQ', this.name, this._id, 'exclusiveWorks');
    this.database.changed.fire(this.name, null, null);
  };
  FileQ.prototype.finalizeExclusive = function () {
    //console.log('FileQ', this.name, this._id, 'finalizeExclusive');
    this.exclusivePromise = null;
    this.handleQ();
  };
  FileQ.prototype.fireDataBaseChanged = function (originalfs) {
    var d = q.defer();
    util.FStats(this.path, d);
    return d.promise.then(
      this.onFStatsForFireDataBaseChanged.bind(this, originalfs)
    );
  };
  FileQ.prototype.onFStatsForFireDataBaseChanged = function (originalfs, newfstats) {
    this.database.changed.fire(this.name, originalfs, newfstats);
  };
  FileQ.prototype.handleQ = function () {
    //console.log(this.name, 'time for next', this.length);
    if (this.nonExclusiveCount < 1) {
      if (this.length > 0) {
        this.pop(this.handleQItemer);
        return;
      } else {
        if (!this.exclusivePromise) {
          this.destroy();
        }
      }
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
    var err;
    if (!lib.isString(name)) {
      err = new lib.Error('INVALID_FILE_NAME', 'Filename for reading must be a string');
      if (defer) {
        defer.reject(err);
      }
      return q.reject(err);
    }
    if(this.closingDefer){
      if(defer){
        defer.resolve(false);
      }
      return q(false);
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
  function doDrop (dropper) {
    var ret = dropper.defer.promise;
    dropper.drop();
    return ret;
  }
  FileDataBase.prototype.drop = function (name, defer) {
    if(this.closingDefer){
      if(defer){
        defer.resolve(false);
      }
      return;
    }
    return this.fileQ(name).drop(defer).then(doDrop);
  };
  function doMove(newname, mover) {
    var ret = mover.defer.promise;
    mover.move(newname);
    return ret;
  }
  FileDataBase.prototype.move = function (name, newname, defer) {
    if(this.closingDefer){
      if(defer){
        defer.resolve(false);
      }
      return;
    }
    return this.fileQ(name).move(defer).then(doMove.bind(null, newname));
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
  FileDataBase.prototype.commit = lib.dummyFunc;

  function FileDataBaseTxn(id, path, db) {
    this.id = id;
    this.path = path;
    this.parentDB = db;
    this.filesWritten = [];
    FileDataBase.call(this, this.parentDB.rootpath+'_'+id);
    this.parentDB.add('txn:'+this.id);
  }
  lib.inherit(FileDataBaseTxn, FileDataBase);
  FileDataBaseTxn.prototype.commit = function (defer) {
    this.doCommit().then(
      this.close.bind(this, defer)
    )
  };
  FileDataBaseTxn.prototype.write = function (name, options, defer) {
    if (!lib.isArray(this.filesWritten)) {
      return q.reject(new lib.Error('ALREADY_DEAD', 'This instance of FileDataBaseTxn is already dead'));
    }
    if (this.filesWritten.indexOf(name) < 0) {
      this.filesWritten.push(name);
    }
    return FileDataBase.prototype.write.call(this, name, options, defer);
  };
  FileDataBaseTxn.prototype.doCommit = function () {
    var d = q.defer();
    this.parentDB.write(this.path, {txndirname: this.parentDB.rootpath+'_'+this.id}, d);
    return d.promise.then(
      this.onTxnDirDone.bind(this)
    );
  };
  FileDataBaseTxn.prototype.onTxnDirDone = function () {
    return q.all(this.filesWritten.map(this.fileWrittenTriggerer.bind(this))).then(
      this.finishCommit.bind(this)
    );
  };
  FileDataBaseTxn.prototype.finishCommit = function () {
    this.parentDB.remove('txn:'+this.id);
    if (this.parentDB.closingDefer) {
      this.parentDB.destroy();
    }
    this.id = null;
    this.parentDB = null;
    this.filesWritten = null;
    return q(true);
  };
  FileDataBaseTxn.prototype.fileWrittenTriggerer = function (filename) {
    if (!this.parentDB) {
      return q.reject(new lib.Error('ALREADY_DEAD', 'This instance of FileDataBaseTxn is already dead'));
    }
    var d = q.defer();
    util.FStats(Path.join(this.parentDB.rootpath, filename), d);
    return d.promise.then(this.fireParentDataBaseChanged.bind(this, filename));
  };
  FileDataBaseTxn.prototype.fireParentDataBaseChanged = function (filename, fstats) {
    console.log('fireParentDataBaseChanged', filename, fstats);
    if (this.parentDB && this.parentDB.changed) {
      console.log('yes!');
      this.parentDB.changed.fire(filename, null, fstats);
    }
    return q(true);
  };

  return FileDataBase;
}

module.exports = createHandler;
