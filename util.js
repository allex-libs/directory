function createUtil(execlib){
  'use strict';
  var lib = execlib.lib,
    Util = require('allex_fsutilsserverruntimelib')(lib),
    q = lib.q;

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

  return Util;
}

module.exports = createUtil;
