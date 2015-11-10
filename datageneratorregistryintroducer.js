function dataGeneratorRegistryIntroducer(execlib){
  'use strict';
  var lib = execlib.lib,
    q = lib.q,
    execSuite = execlib.execSuite,
    dataGeneratorRegistry = execSuite.dataGeneratorRegistry;
  if(dataGeneratorRegistry){
    return;
  }
  execSuite.dataGeneratorRegistry = new execSuite.RegistryBase();
}

module.exports = dataGeneratorRegistryIntroducer;
