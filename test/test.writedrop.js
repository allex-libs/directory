function chunkWriter (chunk, writer) {
  var ret = writer.write(chunk);
  chunk = null;
  return ret;
}

function write(db, filename, text, doappend) {
  return allex_directorylib.util.writeToFile(db, filename, text, doappend);
  /*
  return db.write(filename, {append:doappend}).then(
    chunkWriter.bind(null, text)
  );
  */
}

describe('WriteDrop test', function () {
  loadClientSide(['allex_directorylib']);
  it ('Create a directory database', function () {
    return setGlobal('DB', new allex_directorylib.DataBase('test.dir'));
  });
  it('Just write', function () {
    return write(DB, 'test.text', 'test text', false);
  });
  it('Try drop', function () {
    return DB.drop('test.text');
  });
  it('Write to subdir', function () {
    return write(DB, 'subdir/test.text', 'test text', false);
  });
  it('Try drop from subdir', function () {
    return DB.drop('subdir/test.text');
  });
  it('Write to subdir platform-independent', function () {
    return write(DB, 'subdir/test.text', 'test text', false);
  });
  it('Try drop from subdir platform-independent', function () {
    return DB.drop('subdir/test.text');
  });
});
