function createUtil(execlib){
  'use strict';
  var lib = execlib.lib,
    Util = require('allex_fsutilsserverruntimelib')(lib),
    q = lib.q,
    qlib = lib.qlib,
    JobBase = qlib.JobBase;

  function chunkWriter (chunk, writer) {
    var ret = writer.write(chunk).then(writer.close.bind(writer));
    chunk = null;
    return ret;
  }

  function writeToFile (db, filename, text, doappend) {
    var d = q.defer();
    db.write(filename, {append:doappend}, d).then(
      chunkWriter.bind(null, text)
    );
    return d.promise;
  }

  Util.writeToFile = writeToFile;

  function FileMetaUpdater (db, filename, metadata, options, defer) {
    JobBase.call(this, defer);
    this.db = db;
    this.filename = filename;
    this.metadata = metadata;
    this.options = options;
    this.metaoriginal = {
      data : null
    };
  }
  lib.inherit(FileMetaUpdater, JobBase);
  FileMetaUpdater.prototype.destroy = function () {
    this.options = null;
    this.metadata = null;
    this.filename = null;
    this.db = null;
    JobBase.prototype.destroy.call(this);
  };
  FileMetaUpdater.prototype.go = function () {
    var ret;
    if (!this.defer) {
      return q.reject(new lib.Error('ALREADY_DESTROYED'));
    }
    ret = this.defer.promise;
    this.db.read(this.db.metaPath(this.filename), {modulename: 'allex_jsonparser'}).then(
      this.onMetaReadDone.bind(this),
      this.onMetaReadError.bind(this),
      this.onMetaReadProgress.bind(this)
    );
    return ret;
  };
  FileMetaUpdater.prototype.onWriteFileMetaDone = function(extendedMetadata, result){
    this.resolve(result ? extendedMetadata : null);
  };
  FileMetaUpdater.prototype.onMetaReadDone = function(filesReadCnt){
    var extendedMetadata;
    if (!this.metaoriginal.data){
      console.log('No metadata. Resolving null.');
      return this.resolve(null);
    }
    extendedMetadata = lib.extend(this.metaoriginal.data, this.metadata);
    this.db.writeFileMeta(this.filename, extendedMetadata).then(
      //this.resolve.bind(this,extendedMetadata),
      this.onWriteFileMetaDone.bind(this,extendedMetadata),
      this.resolve.bind(this,null)
    );
  };
  FileMetaUpdater.prototype.onMetaReadError = function(error){
    console.log('Error on reading ' + this.filename + ' .meta. Resolving null.',error);
    this.resolve(null);
  };
  FileMetaUpdater.prototype.onMetaReadProgress = function(od){
    var metaoriginal;
    try{
      this.metaoriginal.data = JSON.parse(od.toString());
    }catch(e){
      console.log('Error on parsing ' + this.filename + ' .meta. Resolving null.',error);
      return this.resolve(null);
    }
  };

  function updateFileMeta (db, filename, metadata, defer) {
    return (new FileMetaUpdater(db, filename, metadata, defer)).go();
  }

  Util.updateFileMeta = updateFileMeta;

  return Util;
}

module.exports = createUtil;
