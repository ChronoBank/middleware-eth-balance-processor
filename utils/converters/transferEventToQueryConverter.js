const _ = require('lodash'),
  BigNumber = require('bignumber.js'),
  TokenContract = require('../../contracts/TokenContract');
//smEvents = require('../../factories/sc/smartContractsEventsFactory');

//const smEvents = _.filter(TokenContract.abi, item => item.type === 'event');

const eventDefinition = _.chain(TokenContract).get('networks')
  .toPairs()
  .map(pair => pair[1].events)
  .flattenDeep()
  .transform((result, ev) => _.merge(result, ev))
  .toPairs()
  .find(pair => pair[1].name === 'Transfer')
  .thru(pair => {
    pair[1].signature = pair[0];
    return pair[1];
  })
  .value();

const topicToArg = (topic, topicIndex) => {
  const bn = BigNumber(topic, 16);
  return {
    e: bn.e,
    c: bn.c,
    index: topicIndex
  };
};

function deepMap (obj, cb, keyPath) {

  let out = _.isArray(obj) ? [] : {};
  let argNotFound = false;

  Object.keys(obj).forEach(k => {

    if (argNotFound)
      return;

    let val;

    if (obj[k] !== null && typeof obj[k] === 'object')

      if (!keyPath) {
        val = deepMap(obj[k], cb, [k]);
      } else {
        keyPath.push(k);
        val = deepMap(obj[k], cb, keyPath);
      }
    else {
      let fullPath = [];
      fullPath.push(k);
      if (keyPath)
        fullPath.push(...keyPath);
      val = cb(obj[k], fullPath);

      if (_.find(fullPath, key => key.indexOf('$') === 0) && val.converted)
        val = {args: {$elemMatch: val.arg}};

    }


    if (!keyPath && _.find(Object.keys(obj[k]), key => key.indexOf('$') === 0)) { //todo
      let data = cb('', [k]);
      if (!data.arg) {
        argNotFound = true;
        return;
      }
    }


    if (!_.isArray(obj) && _.isObject(val) && val.converted) {
      if (!out.$and)
        out.$and = [];
      out.$and.push({args: {$elemMatch: val.arg}});
      return;
    }

    _.isArray(obj) ? out.push(val) :
      out[k] = val;
  });

  return argNotFound ? null : out;
}

function replace (criteria) {

  let paths = _.chain(criteria).keys()
    .filter(key =>
      key.indexOf('$') === 0 || _.chain(criteria[key]).keys().find(nestedKey => nestedKey.indexOf('$') === 0).value()
    )
    .value();

  return _.transform(paths, (result, path) => {

    if (criteria[path].$in) {

      if (!result.$or)
        result.$or = [];

      result.$or.push(...result[path].$in);
      delete result[path];
      return;
    }


    if (criteria[path].$nin || criteria[path].$ne) {

      if (!result.$and)
        result.$and = [];

      let subQuery = _.chain(criteria[path].$nin || [criteria[path].$ne])
        .map(item => {

          if (!item.args)
            return item;

          item.args.$elemMatch.e = {$ne: item.args.$elemMatch.e};
          item.args.$elemMatch.c = {$ne: item.args.$elemMatch.c};
          item.args.$elemMatch.index = {$ne: item.args.$elemMatch.index};

          return item;
        })
        .value();

      result.$and.push(...subQuery);
      delete result[path];
      return;
    }

    if (path === '$or')

      criteria.$or = _.chain(criteria.$or)
        .map(item => {
          let pair = _.toPairs(item)[0];

          if (!pair[1].args)
            return _.fromPairs([pair]);


          return pair[1];
        })
        .value();


  }, criteria);
}

const converter = (query) => {

  let criteria = deepMap(query, (val, keyPath) => {

    let eventParamIndex = _.chain(keyPath)
      .reverse()
      .find(name => _.find(eventDefinition.inputs, {name: name}))
      .thru(name => _.findIndex(eventDefinition.inputs, {name: name}))
      .value();

    if (eventParamIndex === -1)
      return val;

    let input = eventDefinition.inputs[eventParamIndex];

    if (input.indexed) {
      let shiftedIndex = _.chain(eventDefinition.inputs)
        .take(eventParamIndex)
        .filter({indexed: false})
        .size()
        .value();


      eventParamIndex = eventParamIndex - shiftedIndex;

    } else {
      let shiftedIndex = _.chain(eventDefinition.inputs)
        .filter({indexed: true})
        .size()
        .value();

      let origIndex = _.chain(eventDefinition.inputs)
        .filter({indexed: false})
        .findIndex({name: input.name})
        .value();

      eventParamIndex = shiftedIndex + origIndex;
    }


    return {arg: topicToArg(val, eventParamIndex), converted: true};
  });
  criteria.signature = eventDefinition.signature;

  return replace(criteria);

};


module.exports = converter;