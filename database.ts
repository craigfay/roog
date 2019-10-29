// USAGE:
// const data = database('/data');

// data.commit(
//   data.define('actors', {
//     cash: data.num,
//   }),
//   data.define('positions', {
//     cash: data.num,
//     actorId: data.ref('actors'),
//     symbol: data.str,
//     quantity: data.int
//   }),
//   data.define('transactions', {
//     actorId: data.ref('actors'),
//     timestamp: data.iso,
//     action: data.enum('buy', 'sell'),
//     symbol: data.str,
//     quantity: data.int,
//     price: data.num,
//   }),
// )

// data.commit(
//   data.create('actors', {
//     cash: 5000
//   }),
//   data.create('actors', {
//     cash: 5000
//   }),
//   data.define('transactions', {
//     actorId: data.ref('actors'),
//     timestamp: data.iso,
//     action: data.enum('buy', 'sell'),
//     symbol: data.str,
//     quantity: data.int,
//     price: data.num,
//   }),
// )

import {
  CommitMaterial,
  FileManager,
  Database,
  ReadOnlyDatabase,
  Table,
  Record,
  RecordPayload,
  idLookup,
} from './entities';
import { fileManager } from './file-manager';
import { base36 } from './id';

export async function database(dirpath): Promise<Database> {
  const fm = fileManager(dirpath)
  const data = await fm.rebuild();
  if (data instanceof Error) throw data;

  return {
    read: (table:string) => readOnly(data[table]),
    id: id => makeIdGetter(data)(id),
    define,
    create: (table:string, fields:Record) => makeCreator(data)(table, fields),
    update,
    destroy,
    commit: makeCommiter(fm, data),
  }
}

function readOnly(table) {
  const copy = {}
  for (const [id, fields] of Object.entries(table)) {
    copy[id] = { ...fields }
  }
  return copy;
}

// Get a record by id from any table it may be in
function makeIdGetter(data:ReadOnlyDatabase) {
  return function (id:string): idLookup|undefined {
    for (const [table, records] of Object.entries(data)) {
      if (records[id]) return { record: records[id], table };
    }
  }
}

function define(table:string): CommitMaterial {
  return { table, mutation: 'define' }
}

// Guarantee that no id collisions occur
function idGenerator(data:ReadOnlyDatabase) {
  return function() {
    let id = base36();
    for (const records of Object.values(data)) {
      if (records[id]) return idGenerator(data)();
    }
    return id;
  }
}

// Given a database, create a function that can be used to generate
// CommitMaterial with a mutation value of "create".
// Ultimately, this will be used to create new records with no id collisions
function makeCreator(data:ReadOnlyDatabase) {
  return function create(table:string, fields:Record): CommitMaterial {
    const id = idGenerator(data)();
    return {
      table,
      mutation: 'create',
      payload: { id, ...fields },
    }
  }
}

function update(table:string, fields:RecordPayload): CommitMaterial {
  return {
    table,
    mutation: 'update',
    payload: fields,
  }
}

function destroy(table:string, fields:RecordPayload): CommitMaterial {
  return {
    table,
    mutation: 'destroy',
    payload: fields,
  }
}

function makeCommiter(fm:FileManager, data:ReadOnlyDatabase) {
  return async function(...cms:CommitMaterial[]): Promise<Error|Table> {

    const affectedRecords = {};

    // Apply mutations to file
    const write = await fm.commit(...cms);
    if (write instanceof Error) return write;
    
    // Apply mutations to memory
    cms.forEach(async cm => {
 
      if (cm.mutation == 'define') {
        data[cm.table] = {};
      }
  
      else if (cm.mutation == 'create') {
        const { id, ...fields } = cm.payload;
        data[cm.table][id] = fields;
        affectedRecords[id] = fields;
      }
      
      else if (cm.mutation == 'update') {
        const { id, ...newFields } = cm.payload;
        const { ...oldFields } = data[cm.table][id];
        const updated = { ...oldFields, ...newFields };
        data[cm.table][id] = updated;
        affectedRecords[id] = updated;
      }
  
      else if (cm.mutation == 'destroy') {
        delete data[cm.table][cm.payload.id]
      }
    })
    return affectedRecords;
  }
}
