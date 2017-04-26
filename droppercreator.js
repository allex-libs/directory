function createDropper (execlib, FileOperation) {
  'use strict';

  var lib = execlib.lib;

  function FileDropper (name, path, defer) {
    FileOperation.call(this, name, path, defer);
  }
  lib.inherit (FileDropper, FileOperation);

  return FileDropper;
}

module.exports = createDropper;
