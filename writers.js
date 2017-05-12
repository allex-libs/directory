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
  FileWriter.prototype.exclusive = true;
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
      this.reject(err);
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
      this.reject(err);
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
      this.reject.bind(this)
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
      this.reject(err);
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
    if (options && options.txndirname) {
      //console.log('for',name,'returning new TxnCommiter');
      return new TxnCommiter(options.txndirname, name, path, defer);
    }
    if (options && options.modulename){
      if (options.typed) {
        //console.log('for',name,'returning new ParsedFileWriter');
        return new ParsedFileWriter(name, path, options.modulename, options.propertyhash, defer, options.append);
      } else {
        //console.log('for',name,'returning new PerFileParsedFileWriter');
        return new PerFileParsedFileWriter(name, path, options.modulename, options.propertyhash, defer, options.append);
      }
    }
    //console.log('for',name,'returning new RawFileWriter');
    return new RawFileWriter(name, path, defer, options ? options.append : false);
  }
  return writerFactory;
}

module.exports = createWriters;
