function createFileApi(execlib){
  'use strict';
  try {
  var util = require('./util')(execlib);
  require('./parserregistryintroducer')(execlib);
  require('./datageneratorregistryintroducer')(execlib);

  return {
    DataBase: require('./dbcreator')(execlib, util),
    util: util
  };
  } catch (e) {
    console.log(e.stack);
    console.log(e);
  }
}

module.exports = createFileApi;
