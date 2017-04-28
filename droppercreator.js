var fs = require('fs');
function createDropper (execlib, FileOperation) {
  'use strict';

  var lib = execlib.lib;

  function FileDropper (name, path, defer) {
    FileOperation.call(this, name, path, defer);
  }
  lib.inherit (FileDropper, FileOperation);
  FileDropper.prototype.exclusive = true;
  FileDropper.prototype.destroy = function () {
    FileOperation.prototype.destroy.call(this);
  };
  FileDropper.prototype.go = function () {
    this.size().then(
      this.openDefer.resolve.bind(this.openDefer, this)
    );
  };
  FileDropper.prototype.drop = function () {
    if(this.fh){
      fs.close(this.fh,this.onClosedForDrop.bind(this));
    }else{
      this.onClosedForDrop();
    }
  };
  FileDropper.prototype.onClosedForDrop = function (err) {
    this.fh = null;
    if (err) {
      this.error = err;
      this.destroy();
      return;
    }
    fs.unlink(this.path, this.onUnlinked.bind(this));
  };
  FileDropper.prototype.onUnlinked = function (err) {
    if (err) {
      this.error = err;
      this.destroy();
      return;
    }
    fs.access(this.metaName(), this.onMetaCheckForDrop.bind(this));
  };
  FileDropper.prototype.onMetaCheckForDrop = function (err) {
    if (err) {
      this.onMetaUnlinked();
      return;
    }
    fs.unlink(this.metaName(), this.onMetaUnlinked.bind(this));
  };
  FileDropper.prototype.onMetaUnlinked = function (ignoreerr) {
    this.result = this.originalFS;
    this.destroy();
  };

  return FileDropper;
}

module.exports = createDropper;
