
describe('Txn tests', function () {
  loadClientSide(['allex_directorylib']);
  it ('Create a directory database', function () {
    return setGlobal('DB', new allex_directorylib.DataBase('test.dir'));
  });
  it ('Begin a Transaction', function () {
    setGlobal('Txn', DB.begin('.'));
  });
  it ('Write on a Transaction', function () {
    this.timeout(100000);
    return allex_directorylib.util.writeToFile(Txn, 'blah.txt', 'test '+(new Date()));
  });
  it ('Commit the Transaction', function () {
    var d = q.defer(), ret = d.promise;
    Txn.commit(d);
    return ret;
  });
});
