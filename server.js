//Desarrollado por Raimundo Araujo - +18493768181 / https://rcsoft.club.com

//HikVision API Proxy Server con logueo de dos capas y limitador de logueos basado en IP e IP+Username
//Los endpoints del api se confían del rate limiter integrado en el OpenAPI de Hikcentral

//Old:
//{"token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6InJhaW11bmRvLmFyYXVqbyIsImlhdCI6MTc2MDIzNTYyOCwiZXhwIjoxNzYwMjY0NDI4fQ.lZDAIzVizKj-6rxeFfL0rWPYSCzgOwy3EEW01rOdqUw","tokenExpiresIn":"8h","tokenCreatedAt":"2025-10-12T02:20:28.219Z","filterStatus":"1","filterFavorites":[],"filterCapabilities":[],"filterDevices":[],"filterAreas":[],"searchKeywords":"","favorites":[],"sortBy":"","gridSize":"4","currentPage":3,"lastDBUpdate":1760298557843,"invalidTokenCount":0}

(async () => {
    //Cargamos las variales de entorno
    require('dotenv').config();
    
    const fs = require('fs');
    const fsPromise = require('fs').promises;
    const path = require('path');
    const crypto = require('crypto');
    const jwt = require('jsonwebtoken');
    const bcrypt = require('bcryptjs');
    const ldap = require('ldapjs');
    const httpServer = require("./http-server.js");
    const hikcentral = require('./hikcentral.js');
    const { loginRateLimiter, ipLoginRateLimiter } = require('./rate-limit.js');
    const sleep = (t) => { return new Promise((resolve) => { setTimeout(() => { resolve(true); }, t); }); }
    
    await hikcentral.setParams();

    const clients = {};
    const clientsAlt = {};
    const MAX_CLIENTS = process.env?.MAX_CLIENTS || 10;
    const ipPerUserLimit = parseInt(process.env?.LOGIN_RATE_LIMIT_POINTS) || 5;
    const ipLimit = parseInt(process.env?.IP_LOGIN_RATE_LIMIT_POINTS) || 50;

    const PROTOCOL = process.env?.PROTOCOL || 'https';
    const SERVER_IP = process.env?.SERVER_IP || '127.0.0.1';
    const PORT = process.env?.PORT || 3000;
    const JWT_SECRET = process.env?.JWT_SECRET || 'secret_jwt_complex_strig';
    const JWT_EXPIRES_IN = process.env?.JWT_EXPIRES_IN || '8h';
    
    const users = [
        {
            username: process.env?.ADMIN_USERNAME || 'admin',
            passwordHash: process.env?.ADMIN_PASSWORD_HASH || 'admin123'
        }, ...JSON.parse(process.env?.ADDITIONAL_USERS || '[]')
    ];

    const ldapUrls = JSON.parse(process.env.LDAP_URLS || '[]');
    const ldapBaseDN = process.env?.LDAP_BASEDN;
    const ldapDomain = process.env?.LDAP_DOMAIN;
    const ldapAllowedDN = process.env?.LDAP_ALLOWED_CN || 'CCTV';
    const ldapServerError = {
        code: 500,
        status: 'fail',
        message: 'Server Error'
    }

    const dbMinTimeBetweenUpdates = process.env.MIN_TIME_BETWEEN_UPDATES || 3 * 60 * 60 * 1000;//Tres horas
    const captureMinTimeBetweenUpdates = process.env.MIN_TIME_BETWEEN_CAPTURE_UPDATES || 2 * 60 * 60 * 1000;//Una hora
    const publicFolder = 'public/';
    const capturesSubFolder = 'img/captures/';
    const capturesFileExten = 'jpeg';
    const dataUriFileType = 'data:image/jpeg;base64,';

    const endpoints = {
        health: '/health',
        generatehash: '/generatehash',
        auth: '/auth/login',
        ldap: '/ldap/login',
        protected: {
            authCheck: '/auth/check',
            version: '/api/version',
            encodeDeviceList: '/api/encode-devices',
            encodeDevice: '/api/encode-device',
            cameraList: '/api/cameras',
            previewURLs: '/api/cameras/streams',
            camera: '/api/camera',
            status: '/api/camera/status',
            previewURL: '/api/camera/stream',
            capture: '/api/camera/capture',
            presets: '/api/camera/presets',
            patrols: '/api/camera/patrols',
            ptz: '/api/camera/ptz',
            areas: '/api/areas',
            integralSingle: '/api/camera/integral',
            integral: '/api/cameras/integral',
        }
    };
    const jsonHeader = { 'Content-Type': 'application/json' };

    //Generador de token JWT
    const generateToken = (username) => {
        const payload = {
            username,
            iat: Math.floor(Date.now() / 1000)
        };

        return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    };

    //Validador de credenciales
    const validateUser = async (username, password) => {
        const user = users.find(u => u.username === username);
        
        if (! user) { return null; }

        const isValid = await bcrypt.compare(password, user.passwordHash);

        return isValid;
    };

    const clearUserLimiter = (clientIP, username) => {
        try {            
            ipLoginRateLimiter.delete(clientIP);
            loginRateLimiter.delete(`${clientIP}:${username || 'unknown'}`);
        } catch (e) {
            console.log(e);
        }
    }

    const generatePassword = (len = 12) => {
        let lcLetters = 'abcdefghijklmnopqrstuvwxyz';
        let ucLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let numbers = '0123456789';
        let specialChars = '\\\'"`!?@#$.,;:-_%*^+=&|()[]{}<>~/';
        let charsSets = [lcLetters, ucLetters, numbers, specialChars];
        let chars = charsSets.join('');//26 + 26 + 10 + 34
        let passwordlength = len < 8 ? 8 : len;
        //Dígitos por set calculados en base al peso porcentual del set y esa representación en el largo del largo del password solicitado
        let charsDigits = charsSets.map((c) => Math.round(passwordlength * c.length / chars.length));//0.27 + 0.27 + 0.10 + 0.35
        let totalDigits = charsDigits.reduce((a, b) => a + b, 0);//El cero es solo necesario si el array esta vacío
        let passwordObject = [];

        //A veces charsDigits no da el total correcto, da uno mas o uno menos, le sumamos 1 a la posición de specialChars
        if (totalDigits != passwordlength) { totalDigits < passwordlength ? charsDigits[charsDigits.length - 1]++ : charsDigits[charsDigits.length - 1]--; }

        for (let i = 0; i < charsSets.length; i++) {
            for (let e = 0; e < charsDigits[i]; e++) {
                let index = Number(numbers.charAt(Math.floor(Math.random() * numbers.length)));
                let char = charsSets[i].charAt(Math.floor(Math.random() * charsSets[i].length));

                passwordObject.push([index, char]);
            }
        }

        return passwordObject.sort((a, b) => a[0] - b[0]).map((o) => o[1]).join('');
    }

    const getNextAvailableId = (ids = []) => {
        if (ids?.length === 0) return 1;

        const min = Math.min(...ids);
        const max = Math.max(...ids);

        if (min === 1 && ids.length === max) {
            return max + 1;
        }
    
        const idSet = new Set(ids);
    
        for (let i = 1; i <= max + 1; i++) {
            if (! idSet.has(i)) {
                return i;
            }
        }
    }

    const http = new httpServer({
        protocol: PROTOCOL,
        ip: SERVER_IP,
        port: PORT
    });

    http.use((req, res, next) => {
        //Cabeceras CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        
        next();
    });

    //Rate limiter de loguea añadido como middleware
    http.use(async (req, res, next) => {
        //req._url == endpoints.auth || req._url == endpoints.ldap
        if (req._url == endpoints.ldap) {
            try {
                const loginRate = await loginRateLimiter.consume(`${req._clientIP}:${req._dataBody?.username || 'unknown'}`);
                const ipRate = await ipLoginRateLimiter.consume(req._clientIP);

                //console.log(req._dataBody?.username, loginRate, ipRate);
                
                next();
            } catch (rejRes) {
                const isIpLimit = rejRes.consumedPoints > ipLimit;

                const timeLeft = Math.round(rejRes.msBeforeNext / 1000);
                const minutes = Math.ceil(timeLeft / 60);
                const message = ! isIpLimit ? 
                    `Demasiados intentos de logueo para este usuario. Por favor intenta de nuevo en ${minutes} minutes.` : 
                    `Demasiados intentos de logueo para esta IP. Por favor intenta de nuevo en ${minutes} minutes.`;
                
                res.writeHead(429, { 
                    'Content-Type': 'application/json',
                    'Retry-After': Math.ceil(timeLeft)
                });
                res.end(JSON.stringify({
                    status: 'fail',
                    message: message,
                    retryAfter: timeLeft,
                    limitType: ! isIpLimit ? 'ip:username' : 'ip'
                }));
            }
        } else {
            next();
        }
    });

    //Verificación JWT añadida como middleware
    http.use((req, res, next) => {
        const protectedEndpoints = Object.values(endpoints.protected);

        if (protectedEndpoints.includes(req._url) && req._isPost) {
            const authHeader = req.headers['authorization'];
            const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

            if (! token) {
                res.writeHead(401, jsonHeader);
                res.end(JSON.stringify({
                    status: 'fail',
                    message: 'Access token required'
                }));

                return;
            }

            try {
                req._authToken = jwt.verify(token, JWT_SECRET);

                next();
            } catch (err) {
                res.writeHead(403, jsonHeader);
                res.end(JSON.stringify({
                    status: 'fail',
                    message: 'Invalid or expired token'
                }));
                
                return;
            }
        } else {
            next();
        }
    });

    http.get(endpoints.health, (req, res) => {        
        res.writeHead(200, jsonHeader);
        res.end(JSON.stringify({
            status: 'success',
            message: 'API is running',
            timestamp: new Date().toISOString()
        }));
    });

    http.get(endpoints.generatehash, async (req, res) => {
        const password = req?._qsEntries?.password || generatePassword(10);
        const hash = await bcrypt.hash(password, 10);

        res.writeHead(200, jsonHeader);
        res.end(JSON.stringify({
            status: 'success',
            password,
            message: hash,
            timestamp: new Date().toISOString()
        }));
    });

    http.post(endpoints.ldap, async (req, res) => {
        const username = req?._dataBody?.username?.split('@')?.[0] || '';
        const password = req?._dataBody?.password;
        const ldapUsername = `${ldapDomain}\\${username}`;
        const client = ldap.createClient({ url: ldapUrls[Math.floor(Math.random() * ldapUrls.length)] });
        const userData = await new Promise((resolve) => {
            //Implementar errores personalizados con:
            //error, connectError, close, client.bind, client.search, res.on
            //ejemplo: servidor ocupado, intente mas tarde, error 500, etc
            client.on('error', (err) => {
                console.error('LDAP client error:', err);

                return resolve(ldapServerError);
            });

            client.on('connectError', (err) => {
                console.error('LDAP connection failed:', err);

                return resolve(ldapServerError);
            });

            client.on('close', (hadError) => {
                console.warn('LDAP connection closed', hadError ? 'due to error' : '');
            });

            client.bind(ldapUsername, password, (err) => {
                if (err) {
                    console.error('Bind failed:', err, err?.lde_message);//err?.lde_message -> Invalid Credentials

                    client.unbind();

                    return resolve({
                        code: 401,
                        status: 'fail',
                        message: err?.lde_message || err?.message || 'Invalid credentials'
                    });
                }

                const searchOptions = {
                    scope: 'sub',
                    filter: `(sAMAccountName=${username})` ,
                    attributes: ['objectName', 'dn', 'cn', 'sn', 'title', 'description', 'physicalDeliveryOfficeName', 'telephoneNumber', 'givenName', 'whenCreated', 'whenChanged', 'displayName', 'memberOf', 'department', 'company', 'name', 'lastLogon', 'pwdLastSet', 'accountExpires', 'logonCount', 'sAMAccountName', 'sAMAccountType', 'userPrincipalName', 'lockoutTime', 'lastLogonTimestamp', 'mail']
                };

                client.search(ldapBaseDN, searchOptions, (err, res) => {
                    if (err) {
                        console.error('Search error:', err);

                        client.unbind();

                        return resolve(ldapServerError);
                    }

                    const entries = [];

                    res.on('searchEntry', (entry) => {
                        const entryObj = entry?.pojo || entry?.object || {};

                        if (entryObj?.attributes?.[0]?.values?.length) {
                            entryObj.attributes.forEach((a) => {
                                entryObj[a.type] = (a.values?.length || 0) > 1 ? a.values : a.values?.[0];
                            });

                            delete entryObj.attributes;

                            if (Object.keys(entryObj).includes('controls')) {
                                delete entryObj.controls;
                            }

                            entries.push(entryObj);
                        }
                    });

                    /* res.on('searchReference', (ref) => {
                        console.log('Referral:', ref.uris);
                    }); */

                    res.on('error', (err) => {
                        console.error('Search failed:', err);

                        return resolve(ldapServerError);
                    });

                    res.on('end', (result) => {
                        client.unbind((err) => {
                            if (err) {
                                console.error('Unbind error:', err);

                                return;
                            }

                            console.log('Connection closed.');
                        });

                        //console.log('ldapUserData:', entries?.[0]);
                        /*
                        {
                            messageId: 2,
                            protocolOp: 100,
                            type: 'SearchResultEntry',
                            objectName: 'CN=Raimundo Araujo Correa,OU=OPERACIONES-TIC,OU=TECNOLOGIA,OU=Inapa-Users,DC=inapa,DC=local',
                            controls: [],
                            objectClass: [ 'top', 'person', 'organizationalPerson', 'user' ],
                            cn: 'Raimundo Araujo Correa',
                            sn: 'Araujo',
                            title: 'Auxiliar Administrativo',
                            description: 'Auxiliar Administrativo',
                            physicalDeliveryOfficeName: 'Departamento de Operaciones TIC',
                            telephoneNumber: '809-567-1241 Ext.:11410',
                            givenName: 'Raimundo',
                            distinguishedName: 'CN=Raimundo Araujo Correa,OU=OPERACIONES-TIC,OU=TECNOLOGIA,OU=Inapa-Users,DC=inapa,DC=local',
                            instanceType: '4',
                            whenCreated: '20230706175559.0Z',
                            whenChanged: '20251001215636.0Z',
                            displayName: 'Raimundo Araujo Correa',
                            uSNCreated: '66625',
                            memberOf: [
                                'CN=WIFI-RADIUS,OU=Grupos de Sevicios,OU=INAPA-GRUPOS,DC=inapa,DC=local',
                                'CN=Google Sync,OU=Grupos de Seguridad,OU=INAPA-GRUPOS,DC=inapa,DC=local',
                                'CN=AnyDesk,OU=Grupos de Seguridad,OU=INAPA-GRUPOS,DC=inapa,DC=local',
                                'CN=Basico_internet,OU=Internet_basico,OU=INAPA-GRUPOS,DC=inapa,DC=local',
                                'CN=WhatsAPP Web,OU=Grupos de Seguridad,OU=INAPA-GRUPOS,DC=inapa,DC=local',
                                'CN=Publico,OU=Grupos de Distribucion,OU=INAPA-GRUPOS,DC=inapa,DC=local',
                                'CN=Personal Masculino,OU=Grupos de Distribucion,OU=INAPA-GRUPOS,DC=inapa,DC=local',
                                'CN=ReportingGroup {00000000-0000-0000-0000-000000000000},OU=-CRM-,OU=INAPA-Services,DC=inapa,DC=local',
                                'CN=Direccion Tecnologia,OU=Grupos de Distribucion,OU=INAPA-GRUPOS,DC=inapa,DC=local'
                            ],
                            uSNChanged: '26986262',
                            department: 'Departamento de Operaciones TIC',
                            company: 'INAPA',
                            name: 'Raimundo Araujo Correa',
                            objectGUID: "\f�?\x04�'JN��\x18�\r,e�",
                            userAccountControl: '512',
                            badPwdCount: '0',
                            codePage: '0',
                            countryCode: '0',
                            badPasswordTime: '134044640084816277',
                            lastLogoff: '0',
                            lastLogon: '134044642774306007',
                            pwdLastSet: '134028812440635779',
                            primaryGroupID: '513',
                            objectSid: "\x01\x05\x00\x00\x00\x00\x00\x05\x15\x00\x00\x00��w/c��\x1A5�S'+R\x00\x00",
                            accountExpires: '9223372036854775807',
                            logonCount: '289',
                            sAMAccountName: 'raimundo.araujo',
                            sAMAccountType: '805306368',
                            userPrincipalName: 'raimundo.araujo@inapa.gob.do',
                            lockoutTime: '0',
                            objectCategory: 'CN=Person,CN=Schema,CN=Configuration,DC=inapa,DC=local',
                            dSCorePropagationData: [
                                '20250414204627.0Z',
                                '20250414202556.0Z',
                                '20250414200924.0Z',
                                '20250414195307.0Z',
                                '16010101181632.0Z'
                            ],
                            'mS-DS-ConsistencyGuid': "\f�?\x04�'JN��\x18�\r,e�",
                            lastLogonTimestamp: '134038293966350802',
                            mail: 'raimundo.araujo@inapa.gob.do'
                        }
                        */
                       
                        return resolve(! entries?.[0] ? ldapServerError : {
                            code: 200,
                            status: 'success',
                            data: entries[0]
                        });
                    });
                });
            });
        });

        //Si encontamos datos, pero el usuario no pertene al grupo con permiso de usar esta app, denegamos el acceso
        if (userData?.memberOf?.length && ! userData?.memberOf?.some(m => m.includes(`CN=${ldapAllowedDN}`))) {
            userData.code = 401;
            userData.status = 'fail';
            userData.message = 'User does not have permission to access this resource';
        };

        userData.code = userData?.code || 500;

        res.writeHead(userData.code, jsonHeader);
        res.end(JSON.stringify(userData));
    });

    http.post(endpoints.auth, async (req, res) => {
        const username = req?._dataBody?.username;
        const password = req?._dataBody?.password;
        const getJWT = req?._dataBody?.jwt;

        const validCredentialsObj = {
            code: 200,
            status: 'success',
            data: {}
        }
        const invalidCredentialsObj = {
            code: 401,
            status: 'fail',
            data: {}
        };
        
        if (! username || ! password) {
            invalidCredentialsObj.formErrors = {
                username: 'Invalid username',
                password: 'Invalid password'
            }

            res.writeHead(invalidCredentialsObj.code, jsonHeader);
            res.end(JSON.stringify(invalidCredentialsObj));

            return;
        }

        let isUser = await validateUser(username, password);

        if (! isUser) {
            const userDataFetch = await hikcentral.runFetch(`${PROTOCOL}://${SERVER_IP}:${PORT}${endpoints.ldap}`, {
                method: 'post',
                body: JSON.stringify({
                    username,
                    password
                })
            });

            const resCode = userDataFetch?.httpStatusCode || userDataFetch?.code || 401;

            if (resCode > 199 && resCode < 300) {
                validCredentialsObj.data = userDataFetch?.data;
                
                isUser = true;
            } else {
                invalidCredentialsObj.data = userDataFetch?.data;
            }
        }

        if (! isUser) {
            res.writeHead(invalidCredentialsObj.code, jsonHeader);
            res.end(JSON.stringify(invalidCredentialsObj));

            return;
        }

        if (getJWT) {
            validCredentialsObj.data.token = generateToken(username);
            validCredentialsObj.data.expiresIn = JWT_EXPIRES_IN;
            validCredentialsObj.data.timestamp = new Date().toISOString();
        }

        clearUserLimiter(req._clientIP, username);

        res.writeHead(validCredentialsObj.code, jsonHeader);
        res.end(JSON.stringify(validCredentialsObj));
    });

    http.post(endpoints.protected.authCheck, async (req, res) => {
        res.writeHead(200, jsonHeader);
        res.end(JSON.stringify({
            status: 'success',
            message: 'User authentication is ok',
            timestamp: new Date().toISOString()
        }));
    });

    http.post(endpoints.protected.version, async (req, res) => {
        const result = await hikcentral.getHikcentralVersion();
        
        res.writeHead(result?.httpStatusCode || 200, jsonHeader);
        res.end(JSON.stringify(result));
    });

    http.post(endpoints.protected.encodeDeviceList, async (req, res) => {
        const result = await hikcentral.getEncodeDevices();
        
        res.writeHead(result?.httpStatusCode || 200, jsonHeader);
        res.end(JSON.stringify(result));
    });

    http.post(endpoints.protected.encodeDevice, async (req, res) => {
        const {id} = req?._dataBody;
        const result = await hikcentral.getEncodeDevice(id);
        
        res.writeHead(result?.httpStatusCode || 200, jsonHeader);
        res.end(JSON.stringify(result));
    });

    http.post(endpoints.protected.cameraList, async (req, res) => {
        const result = await hikcentral.getCameras();
        
        res.writeHead(result?.httpStatusCode || 200, jsonHeader);
        res.end(JSON.stringify(result));
    });

    http.post(endpoints.protected.previewURLs, async (req, res) => {
        const {ids, protocol} = req?._dataBody;
        const result = await hikcentral.getCamerasPreviewURLs(ids, protocol);

        res.writeHead(result?.httpStatusCode || 200, jsonHeader);
        res.end(JSON.stringify(result));
    });

    http.post(endpoints.protected.camera, async (req, res) => {
        const {id} = req?._dataBody;
        const result = await hikcentral.getCamera(id);
        
        res.writeHead(result?.httpStatusCode || 200, jsonHeader);
        res.end(JSON.stringify(result));
    });

    http.post(endpoints.protected.status, async (req, res) => {
        const {id} = req?._dataBody;
        const result = await hikcentral.getCameraStatus(id);

        res.writeHead(result?.httpStatusCode || 200, jsonHeader);
        res.end(JSON.stringify(result));
    });

    http.post(endpoints.protected.previewURL, async (req, res) => {
        const {id, protocol} = req?._dataBody;
        const result = await hikcentral.getCameraPreviewURL(id, protocol);

        res.writeHead(result?.httpStatusCode || 200, jsonHeader);
        res.end(JSON.stringify(result));
    });

    http.post(endpoints.protected.capture, async (req, res) => {
        const {id} = req?._dataBody;
        const fileData = {
            path: `${publicFolder}${capturesSubFolder}${id}.${capturesFileExten}`,
            publicPath: `${capturesSubFolder}${id}.${capturesFileExten}`,
            exists: false,
            expired: false
        }
        //const imageHeader = { 'Content-Type': 'image/jpeg' };
        const imageHeader = jsonHeader;//Aquí vamos a mandar todo como json para evitar que runFetch convierta el base64 en un blob en el frontend

        try {
            const stats = await fsPromise.stat(fileData.path);

            fileData.exists = true;
            fileData.expired = Date.now() - stats.birthtimeMs > captureMinTimeBetweenUpdates;

            if (! fileData.expired) {
                const fileBuffer = await fsPromise.readFile(fileData.path);
                const base64String = fileBuffer.toString('base64');

                res.writeHead(200, imageHeader);
                res.end(`${dataUriFileType}${base64String}`);

                return true;
            }
        } catch (err) {
            /* if (err.code === 'ENOENT') {
                console.log(`File ${fileData.path} does not exists.`);
            } */

            console.error('An error occurred:', err);

            fileData.exists = false;
        }

        const result = await hikcentral.getCameraCapture(id);

        if (result?.data?.data?.length) {
            const base64Data = result.data.data.replace(dataUriFileType, '');
            const binaryData = Buffer.from(base64Data, 'base64');

            try {
                await fsPromise.writeFile(fileData.path, binaryData);
            } catch (err) {
                console.error('Error writing file:', err);
            }

            res.writeHead(200, imageHeader);
            res.end(result.data.data);

            return true;
        }

        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(! fileData.exists ? '' : fileData.publicPath);
    });

    http.post(endpoints.protected.presets, async (req, res) => {
        const {id} = req?._dataBody;
        const result = await hikcentral.getPTZPresets(id);

        res.writeHead(result?.httpStatusCode || 200, jsonHeader);
        res.end(JSON.stringify(result));
    });

    http.post(endpoints.protected.patrols, async (req, res) => {
        const {id} = req?._dataBody;
        const result = await hikcentral.getPTZPatrols(id);

        res.writeHead(result?.httpStatusCode || 200, jsonHeader);
        res.end(JSON.stringify(result));
    });

    http.post(endpoints.protected.ptz, async (req, res) => {
        const {id, command, action} = req?._dataBody;
        const result = await hikcentral.controlPTZ(id, command, action);

        res.writeHead(result?.httpStatusCode || 200, jsonHeader);
        res.end(JSON.stringify(result));
    });

    http.post(endpoints.protected.areas, async (req, res) => {
        const result = await hikcentral.getAreas();

        res.writeHead(result?.httpStatusCode || 200, jsonHeader);
        res.end(JSON.stringify(result));
    });

    http.post(endpoints.protected.integralSingle, async (req, res) => {
        const {id, protocol} = req?._dataBody;
        const result = await hikcentral.getIntegralSingleCameraData(id, protocol);

        res.writeHead(result?.httpStatusCode || 200, jsonHeader);
        res.end(JSON.stringify(result));
    });

    http.post(endpoints.protected.integral, async (req, res) => {
        const {protocol} = req?._dataBody;
        const result = await hikcentral.getIntegralCameraData(protocol);

        res.writeHead(result?.httpStatusCode || 200, jsonHeader);
        res.end(JSON.stringify(result));
    });

    http.get('/screen', async (req, res) => {
        req._filePath = path.join('public', `${req._url}.html`);

        fs.readFile(req._filePath, (err, data) => {
            if (err) {
                if (http?.notFoundEndpoint) {
                    http.notFoundEndpoint(req, res);

                    return;
                }
                
                res.writeHead(404, {'Content-Type': 'text/html'});
                res.end('404: File not found');

                return;
            }
    
            res.writeHead(200, {'Content-Type': 'text/html'});
            res.end(data);

            return;
        });
    });

    http.get('/sse_events', async (req, res) => {
        const isScreen = req._qsEntries?.isScreen;
        let id = '';

        if (! isScreen) {
            const clientCount =  Object.keys(clients)?.filter(c => 'client' == clients?.[c]?.type)?.length || 0;

            id = req._qsEntries?.clientId || `${crypto.randomUUID()}-${(clientCount + 1).toString().padStart(5, '0')}`;

            if (clientCount >= MAX_CLIENTS) {
                //Mensaje de que alcanzamos máximo número de clientes, pero creo que no esta funcionando
                res.writeHead(403, jsonHeader);
                res.end(JSON.stringify({
                    status: 'fail',
                    message: 'No more clients allowed'
                }));
                
                return;
            }
        } else {
            const screenIds = Object.keys(clients)?.filter(c => 'screen' == clients?.[c]?.type)?.map(m => m.split('-'))?.map(m => Math.abs(m[m.length - 1]))?.sort((a, b) => a - b) || [];

            id = `${crypto.randomUUID()}-${(getNextAvailableId(screenIds)).toString().padStart(5, '0')}`;
        }

        if (! clients?.[id]?.status) {
            clients[id] = {
                status: 'connected',
                type: ! isScreen ? 'client' : 'screen'
            };

            if (! isScreen) { clients[id].screens = {}; }
        }

        clients[id].res = res;

        req.on('close', () => {
            console.log('Closing connection');

            delete clients[id];

            res.end();
        });

        req.on('error', (err) => {
            console.error('SSE request error:', err?.code, err?.message, err?.syscall, err?.hostname);
        
            try {
                res.write("data: " + JSON.stringify({event: 'error', status: 'fail', data: `Error de request SSE: ${err?.message || 'SSE error'}`}) + "\n\n");
            } catch {}
            
            //res.end();
        });

        console.log('Stablishing connection', clients[id]?.type, id);

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        res.write("data: " + JSON.stringify({event: 'connect', status: 'success', data: id}) + "\n\n");
    }); 

    http.get('/get_clients', async (req, res) => {
        const clientList = (Object.keys(clients).filter(c => 'client' == clients[c]?.type) || []).map((m) => {
            const idParts = m.split('-');

            return idParts[idParts.length - 1];
        });

        res.writeHead(200, jsonHeader);
        res.end(JSON.stringify(clientList));
    });

    http.post('/connect_client', async (req, res) => {
        const data = req._dataBody;

        if (! data?.screenId || ! data?.clientId) {
            res.writeHead(404, jsonHeader);
            res.end(JSON.stringify({status: 'fail', message: 'Cliente no encontrado'}));
            
            return;
        }
        const clientKey = Object.keys(clients).find(k => 'client' == clients[k]?.type && k.endsWith(`-${data?.clientId}`));

        if (! clientKey) {
            res.writeHead(404, jsonHeader);
            res.end(JSON.stringify({status: 'fail', message: 'Cliente no encontrado'}));
            
            return;
        }

        if (! clients?.[data.screenId]?.res) {
            res.writeHead(404, jsonHeader);
            res.end(JSON.stringify({status: 'fail', message: 'La pantalla se ha desconectado'}));

            return;
        }

        if (clients?.[clientKey]?.screens?.[data.screenId]) {
            res.writeHead(403, jsonHeader);
            res.end(JSON.stringify({status: 'fail', message: 'Esta pantalla ya se encuentra agregada al cliente selecionado'}));

            return;
        }

        clients[clientKey].screens[data.screenId] = clients[data.screenId];

        res.writeHead(200, jsonHeader);
        res.end(JSON.stringify({status: 'success'}));
    });

    http.post('/share_camera', async (req, res) => {
        const data = req._dataBody;

        if (data?.clientId && data?.screenId && clients?.[data.clientId]) {
            const screenKey = Object.keys(clients).find(k => 'screen' == clients[k]?.type && k.endsWith(`-${data?.screenId}`));

            if (! screenKey || ! clients?.[data.clientId]?.screens?.[screenKey]?.res) {
                res.writeHead(404, jsonHeader);
                res.end(JSON.stringify({status: 'fail', message: 'La pantalla se ha desconectado'}));

                return;
            }

            clients[data.clientId].screens[screenKey].res.write("data: " + JSON.stringify({event: 'update', status: 'success', data: {streamUrl: data?.streamUrl || ''}}) + "\n\n");
        }

        res.writeHead(200, jsonHeader);
        res.end(JSON.stringify({status: 'success'}));
    });

    const loadPantallaUrl = (req, res) => {
        fs.readFile(req._filePath, (err, data) => {
            if (err) {
                if (http?.notFoundEndpoint) {
                    http.notFoundEndpoint(req, res);

                    return;
                }
                
                res.writeHead(404, {'Content-Type': 'text/html'});
                res.end('404: File not found');

                return;
            }
    
            res.writeHead(200, {'Content-Type': 'text/html'});
            res.end(data);

            return;
        });
    }

    http.get('/pantalla1', async (req, res) => {
        req._filePath = path.join('public', `${req._url.replace('1', '')}.html`);

        loadPantallaUrl(req, res);
    });

    http.get('/pantalla2', async (req, res) => {
        req._filePath = path.join('public', `${req._url.replace('2', '')}.html`);

        loadPantallaUrl(req, res);
    });

    http.get('/pantalla3', async (req, res) => {
        req._filePath = path.join('public', `${req._url.replace('3', '')}.html`);

        loadPantallaUrl(req, res);
    });

    http.get('/pantalla4', async (req, res) => {
        req._filePath = path.join('public', `${req._url.replace('4', '')}.html`);

        loadPantallaUrl(req, res);
    });

    http.get('/connect_client_alt', async (req, res) => {
        const clientId = req._qsEntries?.clientId;

        if (! clientId) {
            //No creo que funcione
            res.write("data: " + JSON.stringify({event: 'error', status: 'fail', data: 'Cliente no envió su ID'}) + "\n\n");
            
            return;
        }

        clientsAlt[clientId] = {
            status: 'connected',
            res
        };

        req.on('close', () => {
            console.log('Closing connection');

            delete clientsAlt[clientId];

            res.end();
        });

        req.on('error', (err) => {
            console.error('SSE request error:', err?.code, err?.message, err?.syscall, err?.hostname);
        
            try {
                res.write("data: " + JSON.stringify({event: 'error', status: 'fail', data: `Error de request SSE: ${err?.message || 'SSE error'}`}) + "\n\n");
            } catch {}
            
            //res.end();
        });

        console.log('Stablishing connection', clientId);

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        res.write("data: " + JSON.stringify({event: 'connect', status: 'success', data: clientId}) + "\n\n");
    });

    http.post('/share_camera_alt', async (req, res) => {
        const data = req._dataBody;
        const clientId = data?.clientId || '1';

        if (! clientsAlt?.[clientId]?.res) {
            res.writeHead(404, jsonHeader);
            res.end(JSON.stringify({status: 'fail', message: 'La pantalla se ha desconectado'}));

            return;
        }

        clientsAlt[clientId].res.write("data: " + JSON.stringify({event: 'update', status: 'success', data: {streamUrl: data?.streamUrl || ''}}) + "\n\n");

        res.writeHead(200, jsonHeader);
        res.end(JSON.stringify({status: 'success'}));
    });

    http.onExit = async () => {
        const clientKeys = Object.keys(clients) || [];

        for (let c = 0; c < clientKeys.length; c++) {
            clients?.[clientKeys[c]]?.res?.end();
        }

        return true;
    }

    //Iniciamos el server
    http.run();

    setInterval(async () => {
        const cameraData = await hikcentral.getIntegralCameraData();

        if (! cameraData?.data?.list?.length) { return; }

        for (let c = 0; c < cameraData.data.list.length; c++) {
            const camera = cameraData.data.list[c];

            if (! camera?.cameraIndexCode) { continue; }

            const id = camera.cameraIndexCode;
            const filePath = `${publicFolder}${capturesSubFolder}${id}.${capturesFileExten}`;

            try {
                const stats = await fsPromise.stat(filePath);

                if (! Date.now() - stats.birthtimeMs > captureMinTimeBetweenUpdates) { continue; }
            } catch (err) {
                console.error('Error reading file:', err);;
            }

            const result = await hikcentral.getCameraCapture(id);

            if (result?.data?.data?.length) {
                const base64Data = result.data.data.replace(dataUriFileType, '');
                const binaryData = Buffer.from(base64Data, 'base64');

                try {
                    await fsPromise.writeFile(filePath, binaryData);
                } catch (err) {
                    console.error('Error writing file:', err);
                }
            }

            console.log(result);
            
            await sleep(1250);
        }
    }, 4*60*60*1000);//Cuatro horas
})();