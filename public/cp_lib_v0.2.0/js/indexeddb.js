(function() {
    "use strict;"

    //indexedDB -> DBFactory                    
    /*
        Métodos
            open(name, version(opcional))
                Retorna un IDBOpenDBRequest
            databases()
                Retorna una promesa que resuelve a un objeto como {name: 'xxx', version: 1} o un error
            deleteDatabase(name, options(opcional))
                Retorna un IDBOpenDBRequest
            cmp(first, second)
                Compares two values as keys to determine equality and ordering for IndexedDB operations, such as storing and iterating.
                Valores de retorno
                    -1	1st key is less than the 2nd key
                    0	1st key is equal to the 2nd key
                    1	1st key is greater than the 2nd key
    */

    //IDBOpenDBRequest
    /*
        Eventos
            upgradeneeded
            blocked
            onsuccess
                evt.target.result;//IDBDatabase
    */

    //IDBDatabase
    /*
        Propiedades
            name, version, objectStoreNames(an array)
        Métdos
            open(name, version(opcional))
                Retorna un IDBOpenDBRequest
            close(),
            createMutableFile() (Creates a file handle, allowing files to be stored inside an IndexedDB database.)
            createObjectStore(name, options)
                Propiedades
                    name
                        es el nombre del objectStore
                    options (opcional)
                        keyPath (opcional)
                        autoIncrement (opcional)
                            un objeto con las opciones keyPath y/o autoIncrement, si se usan ambos al mismo tiempo se estaría
                            definiendo un autoIncrement cuyo id sería el keyPath, ej: { keyPath: 'id', autoIncrement: true }

                            El evento openCursor.onsuccess contiene el id en el target.result.key o target.result.primaryKey
                Returns an IDBObjectStore
                    Propiedades
                        indexNames
                            Rist of the names of indexes on objects in this object store.
                        keyPath
                        name
                        transaction(The IDBTransaction object to which this object store belongs),
                        autoIncrement
                    Métodos
                        add(value, key(opcional))
                        clear()
                        count(key o IDBKeyRange.only(z))
                        createIndex(indexName, keyPath(opcional), objectParameters(opcional))
                            objectParameters{}
                                unique, multiEntry, locale
                            Retorna IDBIndex
                        delete(key o IDBKeyRange)
                        get(key o IDBKeyRange) //A pesar se que se puede usar IDBKeyRange, solo devuelve un valor
                        getAll(query(key o IDBKeyRange), count(opcional))
                        getKey(key o IDBKeyRange)
                        getAllKeys(query(opcional key o IDBKeyRange), count(opcional))
                        
                        --- Todos estos métodos retornan un IDBRequest

                        put(item, key(opcional IDBCursor.primaryKey)) //Sin el key put crea un nuevo registro
                            Retorna un IDBRequest y un structured clone
                        openCursor(query(opcional key o IDBKeyRange), direction(opcional IDBCursorDirection))
                            IDBKeyRange (https://developer.mozilla.org/en-US/docs/Web/API/IDBKeyRange)
                                IDBKeyRange.lowerBound(x)               All keys ≥ x
                                IDBKeyRange.lowerBound(x, true)         All keys > x
                                IDBKeyRange.upperBound(y)               All keys ≤ y
                                IDBKeyRange.upperBound (y, true)        All keys < y
                                IDBKeyRange.bound(x, y)                 All keys ≥ x && ≤ y
                                IDBKeyRange.bound(x, y, true, true)     All keys > x && < y
                                IDBKeyRange.bound (x, y, true, false)   All keys > x && ≤ y
                                IDBKeyRange.bound(x, y, false, true)    All keys ≥ x &&< y
                                IDBKeyRange.only(z)                     The key = z
                            IDBCursorDirection
                                'next' (The cursor is opened at the start of the store; then, the cursor returns all records, even duplicates, in the increasing order of keys.)
                                'nextunique' (The cursor is opened at the start of the store; then, the cursor returns all records, that are not duplicates, in the increasing order of keys.)
                                'prev' (The cursor is opened at the start of the store; then, the cursor returns all records, even duplicates, in the decreasing order of keys.)
                                'prevunique' (The cursor is opened at the start of the store; then, the cursor returns all records, that are not duplicates, in the decreasing order of keys)
                            Retorna un IDBRequest y .onsuccess un IDBCursorWithValue
                        openKeyCursor(query(opcional key o IDBKeyRange), direction(opcional))
                            Retorna un IDBRequest y .onsuccess un IDBCursor
                        deleteIndex(indexName)
                        index(name)
                            Retorna un IDBIndex
                                IDBIndex
                                    Propiedad
                                    unique
                                        Returns a boolean that states whether the index allows duplicate keys.
            deleteObjectStore() //Parámetro name, nombre del objectStore
            transaction(storeNames, mode, options)
                storeNames
                    Puede ser un string o un array de strings (Para transacciones en multiples objectStore)
                    Es obligatorio concatenar .objectStore('store a procesar') para abrir uno de los stores del [storeNames] ó storeNames
                Returns IDBTransaction object
            databases()//Retorna un array con los nombres de las bases de datos actuales
        Eventos (Listen to these events using addEventListener() or by assigning an event listener to the oneventname property of this interface.)    
            upgradeneeded
            close
            versionchange
            .onsuccess = (evt) => {}
            .onsuccess = (evt) => {}
            .onsuccess = (evt) => {}
            IDBDatabase via event bubbling from IDBTransaction:
                IDBTransaction abort
                IDBTransaction error
        IDBDatabase, IDBTransaction y IDBRequest
            Soporta
                .onsuccess (Tambien .addEventListener('success', (e) => {}))
                .onerror (Tambien .addEventListener('error', (e) => {}))
    */

    /*
    * Métodos añadidos
        _get
        _getAll
        _add
        _edit
        _delete
        _crud
    */

    //Nomalizamos indexedDB
    //https://developer.mozilla.org/en/docs/Web/API/IndexedDB_API/Using_IndexedDB
    window.indexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
    window.IDBTransaction = window.IDBTransaction || window.webkitIDBTransaction || window.msIDBTransaction || {READ_WRITE: "readwrite"};
    window.IDBKeyRange = window.IDBKeyRange || window.webkitIDBKeyRange || window.msIDBKeyRange;
    
    const dbList = async (name) => { return await window.indexedDB.databases(); }

    const dbExists = async (name) => {
        const dbs = await dbList();

        return dbs.map((db) => db.name).includes(name);
    }

    const dbStart = (dbName, version, upgradeFnc = false) => {
        return new Promise((resolve) => {
            if (! window.indexedDB) { return resolve(false); }
            
            const dbRequest = window.indexedDB.open(dbName, version);

            dbRequest.onupgradeneeded = (evt) => {
                console.info(`dbRequest.onupgradeneeded ejecutandose. Old version: ${evt.oldVersion}. New version: ${evt.newVersion}`);

                let db = evt.target.result;//IDBDatabase

                dbAppendMethods(db);//Añadimos los métodos personalizados

                if (upgradeFnc) { upgradeFnc(db); }
            }

            dbRequest.onsuccess = (evt) => {
                console.info(`dbRequest iniciado satisfactoriamente.`);

                let db = evt.target.result;//IDBDatabase

                db.onversionchange = function() {
                    db.close();//OJO: Ver si esta línea es necesaria... Aparentemente es totalmente necesario para poder hacer updates subsecuentes a la base de datos

                    console.log('La versión de esta báse de datos ha cambiado');
                };

                dbAppendMethods(db);

                resolve(db);
            };

            dbRequest.onerror = (err) => {
                console.error('Error en dbRequest: ', err);

                resolve(false);
            }
        });
    }

    const dbStoreExists = async function (storeName) { return this.objectStoreNames.contains(storeName); }

    /*
        * ts = 
            * "store" || 
            * {
                storeNames: "store1" || ["store1", "store2"], 
                openStore: "store1",
                joinStore: 
                [{
                    store: "store"(store a unir), 
                    field: "fieldName" (field de la colección principal, contiene los keyPath o térrminos para la unión), 
                    index: "indexName" (opcional, índice del store a unir, útil para índeces que no sean keyPath), 
                    resultField: "fieldName" || ["field1" || "field2"] (opcional, field exacto que se quiere extraer ó array de campos)
                }]
            * }
                * Si se envía storeNames y no se envía openStore, se utilizará el storeNames en el lugar de openStore si es una cadena o storeNames[0] si es un array
        * query = 
            * IDBKeyRange ({lower: '' || lowerOpen: '' || upper: '' || upperOpen: ''}) || 
            * "valor keyPath" || 
            * %cadena% || 
            * {
                * index: "indexName" (opcional), 
                * value: "valor" || 
                    * "%cadena%" || 
                    * [{index: 'keyName', value: 'value'}, {index: 'keyName', value: '%value%'}, {value: 'value'}, {value: '%value%'}, 'value, '%value%']
                * resultField: "fieldName" || ["field1" || "field2"] (opcional, field exacto que se quiere extraer ó array de campos)
                * getAll: true || x (Número límite de entradas a devolver. Un número entero positivo, activa limit: x, getAll : true),
                * limit: x (Número máximo de entradas a devolver)
            * }
                * El index representa tanto el keyPath como los índices para no usar otro termino más.
                * Si el index se envía, pero no existe en la base de datos, buscaremos en algun field que tenga ese nombre a traves del cursor
                * Si el query es una cadena entre %%, o un objeto con propiedad value cuyo valor sea una cadena entre %% o urray de objetos con key values [{},{}] 
                    * o un array de valores con o sin %%, la búsqueda se realizará con openCursor, en cuyo caso el parámetro direction será aceptado
            * [{index: 'keyName', value: 'value'}, {index: 'keyName', value: '%value%'}, {value: 'value'}, {value: '%value%'}, 'value, '%value%'] || 
        * direction = 'next' || 'prev'
            * Si se realiza una búsqueda con openCursor, este parámetro define la dirección del loop, ya sea de inicio a fin o de fin a inicio
    */
    const dbGet = function(ts, query = {}, direction = 'next') {
        let objectStore = null;//Aquí se almacenerá el //IDBObjectStore
        
        const resultPromise = () => {
            return new Promise(async (resolve) => {
                //Pruebo a ver si se envió un IDBObjectStore
                if (ts?.name && ts?.transaction && ts?.count) { objectStore = ts; }
                
                if (! objectStore) {
                    if ('string' === typeof ts) { ts = {storeNames: [ts], openStore: ts}; }
                    if ('string' === typeof ts?.storeNames) { ts.storeNames = [ts.storeNames]; }
                    if (! ts?.openStore) { ts.openStore = ts.storeNames[0]; }
                    
                    //IDBTransaction -> IDBObjectStore
                    objectStore = await this.transaction(ts.storeNames, 'readonly').objectStore(ts.openStore);
                }

                //Cadena, número ó IDBKeyRange
                if ('string' === typeof query || ('number' == typeof query && ! isNaN(query)) || Array.isArray(query) || (query?.lower || query?.lowerOpen || query?.upper || query?.upperOpen)) { query = {value: query}; }

                //Si se va a buscar por keyPath, este debe ser un número
                if ('number' == typeof query?.value && ! isNaN(query?.value)) { query.value = parseInt(query.value); }

                if ('string'== typeof query?.value && /^\%.+\%$/.test(query?.value)) { query.value = [query.value]; }

                //Creamos un objeto {search: [{index: '', value: ''}, {substring: ''}]}
                if (Array.isArray(query?.value)) {
                    for (let q = 0; q < query.value.length; q++) {
                        if ('string' == typeof query.value[q]) { query.value[q] = { value: query.value[q] }; }
                        
                        if (query.value[q]?.value && /^\%.+\%$/.test(query.value[q].value)) {
                            query.value[q].substring = query.value[q].value.slice(1).slice(0, -1);
    
                            delete query.value[q].value;
                        }

                        if (query.value[q]?.value && ! query.value[q]?.index) {
                            query.value[q].substring = query.value[q].value;

                            delete query.value[q].value;
                        }
                    }

                    query.search = query.value;
                    
                    delete query.value;
                }
                
                //Si getAll existe y es un número válido, asignamos el número a limit
                if (query?.getAll) {
                    if (/^\d+$/.test(query.getAll)) { query.limit = query.getAll; }

                    query.value = ! query?.value ? null : query.value;//Si el valor llega a ser null, la búsqueda traerá todos los objetos
                }

                if (query?.limit) {
                    if (! /^\d+$/.test(query.limit)) { query.limit = 1; }//Si el limit existe pero no es un número válido, lo ponemos en 1

                    //query.search hace la búsqueda por openCursor, por lo tanto forzaremos el uso de getAll si este no existe
                    if (! query?.search) {
                        query.getAll = true;
                        query.value = ! query?.value ? null : query.value;
                    }
                }

                if (query.index) {
                    if (! objectStore.indexNames.contains(query.index)) {
                        delete query.index
                    } else {
                        //IDBIndex
                        objectStore = objectStore.index(query.index);
                    }
                }

                //Establecemos el default de direction
                direction = ! direction || ('next' != direction && 'prev' != direction) ? 'next' : direction;

                const processResult = (result) => {
                    let resultTemp = [];

                    if (query?.resultField) {
                        if (! Array.isArray(query.resultField)) {
                            if (! query?.getAll) { return result[query.resultField]; }//Extraemos el valor buscado

                            result.forEach((r) => { resultTemp.push(r[query.resultField]); });

                            return resultTemp;
                        } else {
                            if (! query?.getAll) {
                                resultTemp = {};

                                for (const f of query.resultField) { if (result[f]) { resultTemp[f] = result[f]; } }//Extraemos los valores buscados

                                return resultTemp;
                            }

                            result.forEach((r) => {
                                const row = {};

                                for (const f of query.resultField) { if (r[f]) { row[f] = r[f]; } }//Extraemos los valores buscados

                                resultTemp.push(row);
                            });
                            
                            return resultTemp;
                        }
                    }

                    return result;
                }

                //query.getAll se puede ejecutar con query.value en null
                if (query?.value || (null === query?.value && query?.getAll)) {
                    let getData = false;
                    let keys = [];

                    if (! query?.getAll) {
                        getData = objectStore.get(query.value);
                    } else {
                        const getKeys = objectStore.getAllKeys(query.value, query?.limit);
                        getKeys.onsuccess = (evt) => { keys = evt.target.result; };

                        getData = objectStore.getAll(query.value, query?.limit);
                    }
                    
                    getData.onsuccess = async (evt) => {
                        //evt.target es un IDBRequest
                        const result = evt.target.result;//Cuando lo que se busca no existe el result es undefined para get y un array vacío para getAll;
                        
                        if (! result || (Array.isArray(result) && ! result.length)) {
                            //Aquí hacemos un posible fix de un posible resultado vacío porque se comparó un número con una cadena
                            if ('number' === typeof query.value) {
                                let getDataFromString = false;
                                let keysFromString = [];

                                if (! query?.getAll) {
                                    //Repetimos la búsqueda, esta vez convirtiendo los números a textos
                                    getDataFromString = objectStore.get(query.value.toString());
                                } else {
                                    const getKeysFromString = objectStore.getAllKeys(query.value.toString(), query?.limit);
                                    getKeysFromString.onsuccess = (evt) => { keysFromString = evt.target.result; };
            
                                    //Repetimos la búsqueda, esta vez convirtiendo los números a textos
                                    getDataFromString = objectStore.getAll(query.value.toString(), query?.limit);
                                }
                                
                                getDataFromString.onsuccess = async (edfr) => {
                                    const result = edfr.target.result;

                                    if (! result || (Array.isArray(result) && ! result.length)) {
                                        return resolve(! query?.getAll ? '' : []);
                                    } else {
                                        const hasKey = result[0]?.key || result[0]?.id;

                                        //Si el resultado no tiene key o un id, le añadimos los del keysFromString
                                        if (keysFromString.length && ! hasKey) {
                                            for (let i = 0; i < keysFromString.length; i++) { result[i]['key'] = keysFromString[i]; }
                                        }

                                        return resolve(processResult(result));
                                    }
                                };

                                getDataFromString.onerror = (evt) => { return resolve(''); }
                            } else {
                                return resolve(! query?.getAll ? '' : []);
                            }
                        } else {
                            const hasKey = result[0]?.key || result[0]?.id;

                            //Si el resultado no tiene key o un id, le añadimos los del keys
                            if (keys.length && ! hasKey) {
                                for (let i = 0; i < keys.length; i++) { result[i]['key'] = keys[i]; }
                            }

                            return resolve(processResult(result));
                        }
                    }

                    getData.onerror = (evt) => { return resolve(''); }
                }
    
                if (query?.search) {
                    let entryFound = [];

                    const openCursor = objectStore.openCursor(null, direction);

                    openCursor.onsuccess = (evt) => {
                        const cursor = evt.target.result;
    
                        if (cursor) {
                            const row = cursor.value;
                            
                            if (cursor.key) { row.key = cursor.key; }

                            if (query?.search) {
                                let matchesCount = [];

                                query.search.forEach((kv) => {                                    
                                    if (kv?.substring && (! kv?.index ? (JSON.stringify(row).indexOf(kv.substring) + 1) : (row[kv.index].indexOf(kv.substring) + 1))) { matchesCount.push(true); }
                                    if (kv?.index && kv?.value && row[kv.index] == kv.value) { matchesCount.push(true); }
                                });

                                //Si todos los valores hicieron match con el row, lo ponemos con encontrado
                                if (matchesCount.length == query.search.length) { entryFound.push(row); }
                            }

                            if (entryFound.length) {
                                if (! query?.limit) { return resolve(processResult(entryFound[0])); }
                                
                                if (query.limit == entryFound.length) { return resolve(processResult(entryFound)); }
                            }
                            
                            cursor.continue();
                        } else {
                            //No sabía que el else detectaba el final de la iteración del cursor 😛

                            if (entryFound.length) { return resolve(processResult(entryFound)); }//Si encontró algo, lo enviamos
     
                            return resolve(! query.getAll ? '' : []);
                        }
                    }
                }
            });
        }

        return new Promise(async (resolve) => {
            let result = await resultPromise();

            if (! result || 'string' === typeof result || 'number' === typeof result) { return resolve(result); }

            if (! query?.getAll && ! Array.isArray(result)) { result = [result]; }

            if (result?.length && ts?.joinStore) {
                for (let r = 0; r < result.length; r++) {
                    for (const j of ts.joinStore) {
                        result[r][j.field] = await objectStore.transaction.db._get(j.store, {index: j?.index, value: result[r][j.field], resultField: j?.resultField});
                    }
                }
            }

            if (! query?.getAll) { return resolve(result[0]); }

            resolve(result);
        });
    }

    //Esta función es similar a dbGet, lo único que hace es añadir query.getAll
    const dbGetAll = async function(ts, query = {}, limit = null) {
        //Cadena, número ó IDBKeyRange
        if ('string' === typeof query || 'number' === typeof query || (query?.lower || query?.lowerOpen || query?.upper || query?.upperOpen)) { query = {value: query}; }

        if (limit) { query.getAll = limit; }

        if (! query?.getAll) { query.getAll = true; }

        const result = await this._get(ts, query);

        return result;
    }

    //El objeto ts es similar al de dbGet
    const dbGetCount = function(ts) {
        let objectStore = null;

        return new Promise(async (resolve) => {
            //Pruebo a ver si se envió un IDBObjectStore
            if (ts?.name && ts?.transaction && ts?.count) { objectStore = ts; }
                
            if (! objectStore) {
                if ('string' == typeof ts) { ts = {storeNames: [ts], openStore: ts}; }
                if ('string' == typeof ts?.storeNames) { ts.storeNames = [ts.storeNames]; }
                if (! ts?.openStore) { ts.openStore = ts.storeNames[0]; }
                
                //IDBTransaction -> IDBObjectStore
                objectStore = await this.transaction(ts.storeNames, 'readonly').objectStore(ts.openStore);
            }

            const resultObject = await objectStore.count();

            resultObject.onsuccess = (evt) => {
                const evtResult = evt.target.result;

                return resolve(evtResult);
            }

            resultObject.onerror = (evt) => { return resolve(''); }
        });
    }

    const dbGetLastRecord = function(ts) {
        let objectStore = null;

        return new Promise(async (resolve) => {
            if (ts?.name && ts?.transaction && ts?.count) { objectStore = ts; }
            
            if (! objectStore) {
                if ('string' === typeof ts) { ts = {storeNames: [ts], openStore: ts}; }
                if ('string' === typeof ts?.storeNames) { ts.storeNames = [ts.storeNames]; }
                if (! ts?.openStore) { ts.openStore = ts.storeNames[0]; }
                
                //IDBTransaction -> IDBObjectStore
                objectStore = await this.transaction(ts.storeNames, 'readonly').objectStore(ts.openStore);
            }

            const openCursor = objectStore.openCursor(null, 'prev');

            openCursor.onsuccess = (evt) => {
                const cursor = evt.target.result;

                if (cursor) {
                    return resolve(cursor.value);
                } else {
                    return resolve('');
                }
            }
        });
    }

    //keys = key ó IDBKeyRange
    const dbDelete = async function(store, keys) {
        return new Promise (async (resolve) => {
            if (! store || ! keys) { resolve(false); }

            if (! Array.isArray(keys)) { keys = [keys]; }

            if (! keys.length) { resolve(false); }
            
            const transactionObject = 'string' === typeof store ? await this.transaction(store, 'readwrite').objectStore(store) : store;
            let response = {success: []};
            let valuesCount = 0;

            const erase = async (count = 0) => {
                let record = await transactionObject.delete(keys[count]);

                //No se hace mas verificaciones porque en el caso de que record no exista, igual el borrado reportará success
                record.onsuccess = function(evt) {
                    response.success.push(keys[count]);

                    if (count == keys.length - 1) { resolve(response); }
                }

                //No se en qué situación onerror se puede ejecutar ya que intentar eliminar un id que no existe no genera error
                record.onerror = function(evt) {
                    delete response.success;

                    response.error = evt.target.error.message;

                    resolve(response);
                }

                valuesCount++;

                if (valuesCount < keys.length) { erase(valuesCount); }
            }

            if (transactionObject) { erase(valuesCount); }

            /*if (transactionObject) {
                for (let v = 0; v < keys.length; v++) {
                    let record = await transactionObject.delete(keys[v]);

                    //No se hace mas verificaciones porque en el caso de que record no exista, igual el borrado reportará success
                    record.onsuccess = function(evt) {
                        response.success.push(keys[v]);

                        valuesCount++;

                        if (valuesCount == keys.length) { resolve(response); }
                    }

                    //No se en qué situación onerror se puede ejecutar ya que intentar eliminar un id que no existe no genera error
                    record.onerror = function(evt) {
                        delete response.success;

                        response.error = evt.target.error.message;

                        resolve(response);
                    }
                }
            }*/
        });
    }

    const dbClear = async function(store) {
        return new Promise (async (resolve) => {
            if (! store) { resolve(false); }

            const transactionObject = 'string' === typeof store ? await this.transaction(store, 'readwrite').objectStore(store) : store;

            const clearRequest = transactionObject.clear();
      
            clearRequest.onsuccess = (evt) => {
                return resolve(true);
            }

            clearRequest.onerror = (evt) => {
                return resolve(false);
            }
        });
    }

    //Asuminos que para un update los records enviados contienen el ID en la primera posición
    //OJO: dbPut y dbAdd funcionan idénticos, creo que se puede quedar una sola opción y manejar el asunto de los trackUpdates
    //extrayendo este valor del record a actualizar con dbGet
    const dbPut = async function(store, values, trackUpdates = false) {
        return new Promise (async (resolve) => {
            if (! store || ! values) { resolve(false); }

            if (! Array.isArray(values)) { values = [values]; }

            if (! values.length) { resolve(false); }
        
            const transactionObject = 'string' == typeof store ? await this.transaction(store, 'readwrite').objectStore(store) : store;
            let response = {success: []};
            let valuesCount = 0;

            const put = async (count = 0) => {
                if (trackUpdates) {
                    const f = new Date().getTime();

                    values[count].updated_at = f;

                    if (! values[count].created_at) { values[count].created_at = f; }
                }

                let record = await transactionObject.put(values[count]);

                record.onsuccess = function(evt) {
                    response.success.push(evt.target.result);

                    if (count == values.length - 1) { resolve(response); }
                }

                record.onerror = function(evt) {
                    delete response.success;

                    response.error = evt.target.error.message;

                    resolve(response);
                }

                valuesCount++;

                if (valuesCount < values.length) { put(valuesCount); }
            }

            if (transactionObject) { put(valuesCount); }

            /*if (transactionObject) {
                for (let v = 0; v < values.length; v++) {
                    let record = await transactionObject.put(values[v]);

                    record.onsuccess = function(evt) {
                        response.success.push(evt.target.result);

                        valuesCount++;

                        if (valuesCount == values.length) { resolve(response); }
                    }

                    record.onerror = function(evt) {
                        delete response.success;

                        response.error = evt.target.error.message;

                        resolve(response);
                    }
                }
            }*/
        });
    }

    const dbAdd = async function(store, values, trackUpdates = false) {
        return new Promise(async (resolve) => {
            if (! store || ! values) { resolve(false); }

            if (! Array.isArray(values)) { values = [values]; }

            if (! values.length) { resolve(false); }

            const transactionObject = 'string' == typeof store ? await this.transaction(store, 'readwrite').objectStore(store) : store;
            let response = {success: []};
            let valuesCount = 0;

            const add = async (count = 0) => {
                if (trackUpdates) {
                    const f = new Date().getTime();

                    values[count].updated_at = f;
                    values[count].created_at = f;
                }

                let record = await transactionObject.add(values[count]);

                record.onsuccess = function(evt) {
                    response.success.push(evt.target.result);//autoIncrement ID

                    if (count == values.length - 1) { resolve(response); }
                }

                record.onerror = function(evt) {
                    delete response.success;

                    response.error = evt.target.error.message;

                    resolve(response);
                }

                valuesCount++;

                if (valuesCount < values.length) { add(valuesCount); }
            }

            if (transactionObject) { add(valuesCount); }

            /* for (let v = 0; v < values.length; v++) {
                if (trackUpdates) {
                    const f = new Date().getTime();

                    values[v].updated_at = f;
                    values[v].created_at = f;
                }

                let record = await transactionObject.add(values[v]);

                record.onsuccess = function(evt) {
                    response.success.push(evt.target.result);//autoIncrement ID

                    valuesCount++;

                    if (valuesCount == values.length) { resolve(response); }
                }

                record.onerror = function(evt) {
                    delete response.success;

                    response.error = evt.target.error.message;

                    resolve(response);
                }
            } */
        });
    }

    const dbCrud = async function(store, crud, trackUpdates = false) {
        const transactionObject = 'string' == typeof store ? await this.transaction(store, 'readwrite').objectStore(store) : store;

        if (transactionObject) {
            const deleteComplete = await this._delete(transactionObject, crud.delete, trackUpdates);
            const updateComplete = await this._put(transactionObject, crud.update, trackUpdates);
            const createComplete = await this._add(transactionObject, crud.create, trackUpdates);

            if (
                (deleteComplete || false === deleteComplete) && 
                (updateComplete || false === updateComplete) && 
                (createComplete || false === createComplete)
            ) {
                const errorMsg = deleteComplete?.error || deleteComplete?.error?.message || 
                                    updateComplete?.error || updateComplete?.error?.message || 
                                    createComplete?.error || createComplete?.error?.message;

                if (errorMsg) { return {error: errorMsg}; }

                return {delete: deleteComplete, update: updateComplete, create: createComplete}
            }
        }
    }

    const dbGetIndexNames = async function(store) {
        if (! store) { return false; }

        const transactionObject = 'string' == typeof store ? await this.transaction(store, 'readwrite').objectStore(store) : store;

        if (transactionObject) { return transactionObject.indexNames; }

        return [];
    }

    const dbAppendMethods = (r) => {
        r._storeExists = dbStoreExists;
        r._get = dbGet;
        r._getAll = dbGetAll;
        r._getCount = dbGetCount;
        r._count = dbGetCount;
        r._getLastRecord = dbGetLastRecord;
        r._add = dbAdd;
        r._put = dbPut;
        r._delete = dbDelete;
        r._clear = dbClear;
        r._crud = dbCrud;
        r._getIndexNames = dbGetIndexNames;
    }

    const functionList = [dbList, dbExists, dbStart, dbGet, dbGetAll, dbDelete, dbPut, dbAdd, dbCrud, dbGetIndexNames];

    functionList.forEach((n) => { __CPLIB__[n.name] = n; });
})();