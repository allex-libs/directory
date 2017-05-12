function chunkWriter (chunk, writer) {
  var ret = writer.write(chunk);
  chunk = null;
  return ret;
}

function write(db, filename, text, doappend) {
  return directorylib.util.writeToFile(db, filename, text, doappend);
  /*
  return db.write(filename, {append:doappend}).then(
    chunkWriter.bind(null, text)
  );
  */
}

describe('WriteDrop test', function () {
  loadClientSide(['allex:directory:lib']);
  it ('Create a directory database', function () {
    return setGlobal('DB', new directorylib.DataBase('test.dir'));
  });
  it('Just write', function () {
    return write(DB, 'test.text', 'test text', false);
  });
  it('Try drop', function () {
    return DB.drop('test.text');
  });
});
