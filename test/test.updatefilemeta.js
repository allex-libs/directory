function expectAllFieldsToExist(defer,metaObj){
  expect(metaObj.a).to.exist;
  expect(metaObj.b).to.exist;
  expect(metaObj.c).to.exist;
  expect(metaObj.a).to.be.equal(5);
  expect(metaObj.b).to.be.equal(7);
  expect(metaObj.c).to.be.equal(9);
  defer.resolve(true);
}

describe('WriteDrop test', function () {
  loadClientSide(['allex_directorylib']);
  it ('Create a directory database', function () {
    return setGlobal('DB', new allex_directorylib.DataBase('test.dir'));
  });
  it ('Write some content to .meta', function () {
    return DB.writeFileMeta('somefile.text',{a:5, b:7});
  });
  it ('Update .meta', function () {
    var ret = q.defer();
    DB.updateFileMeta('somefile.text',{c:9}).then(
      expectAllFieldsToExist.bind(null,ret),
      console.log.bind(console)
    );
    return ret.promise;
  });
});
