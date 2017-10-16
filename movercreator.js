function createMover (execlib, FileOperation, Node) {
  'use strict';

  var lib = execlib.lib,
    fs = Node.Fs;

  function FileMover (name, path, defer) {
    FileOperation.call(this, name, path, defer);
  }
  lib.inherit (FileMover, FileOperation);
  FileMover.prototype.exclusive = true;
  FileMover.prototype.go = function () {
    this.size().then(
      this.openDefer.resolve.bind(this.openDefer, this)
    );
  };
  FileMover.prototype.move = function (newname) {
    if(this.fh){
      fs.close(this.fh,this.onClosedForMove.bind(this, newname));
    }else{
      this.onClosedForMove(newname);
    }
  };
  FileMover.prototype.onClosedForMove = function (newname, err) {
    this.fh = null;
    if (err) {
      this.error = err;
      this.destroy();
      return;
    }
    fs.rename(this.path, newname, this.onRenamed.bind(this, newname));
  };
  FileMover.prototype.onRenamed = function (newname, err) {
    if (err) {
      this.error = err;
      this.destroy();
      return;
    }
    fs.access(this.metaName(), this.onMetaCheckForMove.bind(this, newname));
  };
  FileMover.prototype.onMetaCheckForMove = function (newname, err) {
    if (err) {
      this.onMetaMoved();
      return;
    }
    fs.rename(this.metaName(), this.metaName(newname), this.onMetaMoved.bind(this));
  };
  FileMover.prototype.onMetaMoved = function (ignoreerr) {
    this.result = this.originalFS;
    this.destroy();
  };

  return FileMover;
}

module.exports = createMover;
