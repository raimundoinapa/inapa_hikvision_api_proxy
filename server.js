//Desarrollado por Raimundo Araujo - +18493768181 / https://rcsoft.club.com

//HikVision API Proxy Server con logueo de dos capas y limitador de logueos basado en IP e IP+Username
//Los endpoints del api se confían del rate limiter integrado en el OpenAPI de Hikcentral

(async () => {
    //Cargamos las variales de entorno
    require('dotenv').config();

    //Sin estos valores el servidor no debe arrancar (evita secretos por defecto)
    const requiredEnv = ['JWT_SECRET', 'ADMIN_PASSWORD_HASH', 'HIKVISION_API_URL', 'HIKVISION_PARTNER_KEY', 'HIKVISION_PARTNER_SECRET'];
    const missingEnv = requiredEnv.filter((key) => ! process.env?.[key]);

    if (missingEnv.length) {
        console.error(`Variables de entorno requeridas no definidas: ${missingEnv.join(', ')}`);
        process.exit(1);
    }
    
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
    const { getLdapUrls, getLdapTlsOptions } = require('./ldap-config.js');
    const sleep = (t) => { return new Promise((resolve) => { setTimeout(() => { resolve(true); }, t); }); }
    
    await hikcentral.setParams();

    const clients = {};
    const clientsAlt = {};
    const MAX_CLIENTS = process.env?.MAX_CLIENTS || 10;
    //IPs de proxies de confianza (TRUST_PROXY). Vacío = no confiar en cabeceras reenviadas.
    const trustedProxies = String(process.env?.TRUST_PROXY || '').split(',').map((ip) => ip.trim()).filter(Boolean);

    const PROTOCOL = process.env?.PROTOCOL || 'https';
    const SERVER_IP = process.env?.SERVER_IP || '127.0.0.1';
    const PORT = process.env?.PORT || 3000;
    const JWT_SECRET = process.env?.JWT_SECRET;
    const JWT_EXPIRES_IN = process.env?.JWT_EXPIRES_IN || '8h';
    //Clave compartida por las pantallas/TV. Se envía en la URL (?key=) o en el header X-Screen-Key.
    //Sin esta variable los endpoints de pantalla quedan bloqueados (fail closed).
    const SCREEN_ACCESS_KEY = process.env?.SCREEN_ACCESS_KEY || '';
    
    const users = [
        {
            username: process.env?.ADMIN_USERNAME || 'admin',
            passwordHash: process.env?.ADMIN_PASSWORD_HASH
        }, ...JSON.parse(process.env?.ADDITIONAL_USERS || '[]')
    ];

    const ldapUsesTls = 'https' == String(PROTOCOL).toLowerCase();
    const ldapUrls = getLdapUrls(PROTOCOL, JSON.parse(process.env.LDAP_URLS || '[]'));
    const ldapTlsOptions = getLdapTlsOptions();
    const ldapBaseDN = process.env?.LDAP_BASEDN;
    const ldapDomain = process.env?.LDAP_DOMAIN;
    //Grupos de AD con acceso (separados por coma). Se acepta también el nombre antiguo LDAP_ALLOWED_DN.
    const ldapAllowedGroups = process.env?.LDAP_ALLOWED_CN || process.env?.LDAP_ALLOWED_DN || 'CCTV';
    const ldapServerError = {
        code: 500,
        status: 'fail',
        message: 'Server Error'
    }

    const dbMinTimeBetweenUpdates = process.env.MIN_TIME_BETWEEN_UPDATES || 3 * 60 * 60 * 1000;//Tres horas
    //Antigüedad máxima del contenido de una captura (TTL)
    const captureMinTimeBetweenUpdates = Number(process.env.MIN_TIME_BETWEEN_CAPTURE_UPDATES) || 60 * 60 * 1000;//Una hora
    //El barrido en segundo plano es un piso de 4 horas, no la fuente principal de
    //frescura: el visor captura y sube una imagen al detener cada stream, y
    // /api/camera/capture sirve desde disco mientras la edad sea menor que el TTL.
    //Un barrido más frecuente multiplica las peticiones a HikCentral y golpea cámaras
    //fuera de línea sin beneficio para el operador.
    const captureRefreshInterval = Number(process.env.CAPTURE_REFRESH_INTERVAL) || 4 * 60 * 60 * 1000;
    const formatDuration = (ms) => ms >= 60000 ? `${Math.round(ms / 60000)} min` : `${Math.round(ms / 1000)} s`;
    const publicFolder = 'public/';
    const capturesSubFolder = 'img/captures/';
    const capturesFileExten = 'jpeg';
    const capturesMimeType = `image/${capturesFileExten}`;
    const dataUriFileType = `data:${capturesMimeType};base64,`;
    //Tope del JPEG que un operador puede subir desde el navegador (bytes ya decodificados).
    const captureUploadMaxBytes = Number(process.env.CAPTURE_UPLOAD_MAX_BYTES) || 4 * 1024 * 1024;
    //Ids del catálogo vigente: capture-upload solo escribe capturas de cámaras conocidas.
    //Sin esta lista, un JWT válido podía crear archivos para ids inventados y llenar el disco.
    const knownCameraIds = new Set();

    //Antigüedad del contenido de una captura en disco (null = no existe).
    //Se usa mtimeMs y no birthtimeMs: en Windows la fecha de creación no cambia
    //al reescribir el archivo, así que la caché nunca se consideraba válida.
    const getCaptureAge = async (filePath) => {
        try {
            const stats = await fsPromise.stat(filePath);

            return Date.now() - stats.mtimeMs;
        } catch (err) {
            if ('ENOENT' != err?.code) {
                console.error(`No se pudo leer la captura ${filePath}:`, err?.message || err);
            }

            return null;
        }
    };

    //Reemplaza el catálogo de ids conocidos. Se guardan como texto porque el id
    //llega desde el JSON del navegador y así la comparación es directa.
    const setKnownCameraIds = (cameras) => {
        knownCameraIds.clear();

        for (const camera of Array.isArray(cameras) ? cameras : []) {
            if (camera?.cameraIndexCode) {
                knownCameraIds.add(String(camera.cameraIndexCode));
            }
        }
    };

    //El catálogo se toma de HikCentral al arrancar y en cada refresco de capturas.
    //Si la consulta falla se conserva el catálogo anterior (nunca se vacía por un error).
    const refreshKnownCameraIds = async () => {
        try {
            const cameraData = await hikcentral.getCameras();

            if (cameraData?.data?.list?.length) {
                setKnownCameraIds(cameraData.data.list);
            }
        } catch (err) {
            console.error('No se pudo cargar el catálogo de cámaras:', err?.message || err);
        }
    };

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
            captureUpload: '/api/camera/capture-upload',
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

    //Comparación en tiempo constante para no filtrar la clave de pantalla por temporización
    const timingSafeEqual = (a, b) => {
        const left = Buffer.from(String(a ?? ''));
        const right = Buffer.from(String(b ?? ''));

        return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
    };

    //El token puede venir en Authorization: Bearer (normal) o en ?token= (EventSource no permite headers)
    const getRequestJwt = (req, allowQuery = true) => {
        const authHeader = String(req.headers?.['authorization'] || '');
        const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
        const queryToken = allowQuery ? String(req._qsEntries?.token || '') : '';

        return bearer || queryToken;
    };

    const hasValidJwt = (req, allowQuery = true) => {
        const token = getRequestJwt(req, allowQuery);

        if (! token) { return false; }

        try {
            req._authToken = jwt.verify(token, JWT_SECRET);

            return true;
        } catch {
            return false;
        }
    };

    const hasValidScreenKey = (req) => {
        const key = req.headers?.['x-screen-key'] || req._qsEntries?.key;

        return Boolean(SCREEN_ACCESS_KEY) && timingSafeEqual(key, SCREEN_ACCESS_KEY);
    };

    const sendUnauthorized = (res, message) => {
        res.writeHead(401, jsonHeader);
        res.end(JSON.stringify({status: 'fail', message}));
    };

    if (! SCREEN_ACCESS_KEY) {
        console.warn('SCREEN_ACCESS_KEY no está definida: /screen, /pantalla*, /sse_events?isScreen=true, /get_clients y /connect_client* responderán 401.');
    }

    //Validador de credenciales
    const validateUser = async (username, password) => {
        const user = users.find(u => u.username === username);
        
        if (! user) { return null; }

        const isValid = await bcrypt.compare(password, user.passwordHash);

        return isValid;
    };

    //La clave del limitador se normaliza igual que el usuario de AD: sin dominio y sin distinguir mayúsculas.
    //Así "alice", "ALICE" y "alice@dominio" comparten el mismo contador.
    const normalizeLimiterUsername = (username) => {
        const value = String(username ?? '').trim().toLowerCase().replace(/@.*$/, '').slice(0, 256);

        return value || 'unknown';
    };

    const getLimiterKeys = (clientIP, username) => {
        const ip = String(clientIP || 'unknown');

        return {
            ip,
            user: `${ip}:${normalizeLimiterUsername(username)}`
        };
    };

    //Solo consultamos el estado: un intento exitoso no consume puntos.
    const getBlockedLimiter = async (keys) => {
        const checks = [
            {limiter: loginRateLimiter, key: keys.user, type: 'ip:username'},
            {limiter: ipLoginRateLimiter, key: keys.ip, type: 'ip'}
        ];

        for (const check of checks) {
            const state = await check.limiter.get(check.key);

            if (state && state.consumedPoints >= check.limiter.points && state.msBeforeNext > 0) {
                return {type: check.type, msBeforeNext: state.msBeforeNext};
            }
        }

        return null;
    };

    //Se llama únicamente cuando las credenciales fallan.
    const registerFailedLogin = async (keys) => {
        await Promise.allSettled([
            loginRateLimiter.consume(keys.user),
            ipLoginRateLimiter.consume(keys.ip)
        ]);
    };

    //En un login exitoso limpiamos solo la clave de ese usuario.
    //Nunca borramos el contador compartido por IP: eso permitía a una cuenta válida
    //resetear el presupuesto de intentos de toda la red.
    const clearUserLimiter = (keys) => {
        try {
            loginRateLimiter.delete(keys.user);
        } catch (e) {
            console.log(e);
        }
    };

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
        port: PORT,
        trustedProxies
    });

    http.use((req, res, next) => {
        //Cabeceras CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Screen-Key');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        
        next();
    });

    //Rate limiter de logueo: solo los intentos fallidos consumen puntos.
    //Los GET/OPTIONS no cuentan (los handlers de login son POST).
    http.use(async (req, res, next) => {
        const isLoginPost = 'post' == req._method && (req._url == endpoints.ldap || req._url == endpoints.auth);

        if (! isLoginPost) {
            next();

            return;
        }

        const keys = getLimiterKeys(req._clientIP, req._dataBody?.username);

        try {
            const blocked = await getBlockedLimiter(keys);

            if (! blocked) {
                next();

                return;
            }

            const timeLeft = Math.max(1, Math.ceil(blocked.msBeforeNext / 1000));
            const minutes = Math.ceil(timeLeft / 60);
            const isIpLimit = 'ip' === blocked.type;
            const message = ! isIpLimit ?
                `Demasiados intentos de logueo para este usuario. Por favor intenta de nuevo en ${minutes} minutes.` :
                `Demasiados intentos de logueo para esta IP. Por favor intenta de nuevo en ${minutes} minutes.`;

            res.writeHead(429, {
                'Content-Type': 'application/json',
                'Retry-After': timeLeft
            });
            res.end(JSON.stringify({
                status: 'fail',
                message: message,
                retryAfter: timeLeft,
                limitType: blocked.type
            }));
        } catch (err) {
            //Un fallo del limitador no debe impedir el login
            console.error('Rate limiter error:', err);
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

    //Autorización de operadores y pantallas para los endpoints que no están bajo /api.
    //- Solo JWT: /generatehash, /share_camera, /share_camera_alt y /sse_events de cliente.
    //- Sin autenticación (decisión operativa del 15/11/2026): /pantalla1..4,
    //  /pantalla.html y /connect_client_alt. Son pantallas internas de solo lectura:
    //  reciben el stream, no ejecutan acciones.
    //- Clave de pantalla o JWT: /screen, /screen.html, /get_clients, /connect_client
    //  y /sse_events?isScreen=true.
    http.use((req, res, next) => {
        const url = req._url;
        const isScreenSse = '/sse_events' == url && Boolean(req._qsEntries?.isScreen);
        const operatorOnly = [endpoints.generatehash, '/share_camera', '/share_camera_alt'];
        const openScreenEndpoints = [
            '/pantalla1', '/pantalla2', '/pantalla3', '/pantalla4',
            '/pantalla.html', '/connect_client_alt'
        ];
        const screenEndpoints = [
            '/screen', '/screen.html',
            '/get_clients', '/connect_client'
        ];

        if (openScreenEndpoints.includes(url)) {
            return next();
        }

        if (operatorOnly.includes(url) || ('/sse_events' == url && ! isScreenSse)) {
            //El token en query solo se acepta para SSE (EventSource no permite headers)
            if (! hasValidJwt(req, '/sse_events' == url)) {
                sendUnauthorized(res, 'Access token required');

                return;
            }

            return next();
        }

        if (screenEndpoints.includes(url) || isScreenSse) {
            if (! hasValidScreenKey(req) && ! hasValidJwt(req)) {
                sendUnauthorized(res, 'Screen access key required');

                return;
            }

            return next();
        }

        next();
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
        const providedPassword = req?._qsEntries?.password;
        const password = providedPassword || generatePassword(10);
        const hash = await bcrypt.hash(password, 10);

        //Si el llamador envió la contraseña no la devolvemos en la respuesta
        res.writeHead(200, jsonHeader);
        res.end(JSON.stringify({
            status: 'success',
            ...(providedPassword ? {} : {password}),
            message: hash,
            timestamp: new Date().toISOString()
        }));
    });

    //Autenticación LDAP en proceso: /auth/login la llama directamente para no enviar la contraseña por la red
    //Un usuario de AD solo entra si pertenece a alguno de los grupos permitidos.
    //memberOf llega como array (varios grupos) o como string (un solo grupo).
    const getGroupCN = (dn) => {
        const firstRdn = String(dn || '').split(',')[0].trim();
        const eq = firstRdn.indexOf('=');

        return eq === -1 ? firstRdn.toLowerCase() : firstRdn.slice(eq + 1).trim().toLowerCase();
    };

    const isMemberOfAllowedGroups = (memberOf, allowedGroups) => {
        const groups = (Array.isArray(memberOf) ? memberOf : [memberOf])
            .filter((group) => 'string' == typeof group && group.trim());
        const allowed = String(allowedGroups || '')
            .split(',')
            .map((group) => group.trim().toLowerCase())
            .filter(Boolean);

        if (! allowed.length) {
            return false;//Sin grupos configurados se deniega el acceso (fail closed)
        }

        return groups.some((dn) => allowed.includes(getGroupCN(dn)));
    };

    const authenticateLdap = async (usernameParam, password) => {
        const username = 'string' == typeof usernameParam ? usernameParam.split('@')[0].trim() : '';

        //Un usuario vacío puede provocar un bind anónimo y luego un filtro inválido.
        //Validamos antes de tocar LDAP y evitamos inyección en el filtro.
        if (! username || ! /^[A-Za-z0-9._-]+$/.test(username) || 'string' != typeof password || ! password) {
            return {
                code: 401,
                status: 'fail',
                message: 'Invalid credentials'
            };
        }

        const ldapUsername = `${ldapDomain}\\${username}`;
        let client;

        try {
            client = ldap.createClient({
                url: ldapUrls[Math.floor(Math.random() * ldapUrls.length)],
                ...(ldapUsesTls ? { tlsOptions: ldapTlsOptions } : {})
            });
        } catch (err) {
            console.error('LDAP client creation failed:', err);

            return ldapServerError;
        }

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

            try {
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
                    //Objeto en vez de string: escapa caracteres LDAP y evita inyección/crash por filtros inválidos
                    filter: new ldap.EqualityFilter({attribute: 'sAMAccountName', value: username}),
                    attributes: ['objectName', 'dn', 'cn', 'sn', 'title', 'description', 'physicalDeliveryOfficeName', 'telephoneNumber', 'givenName', 'whenCreated', 'whenChanged', 'displayName', 'memberOf', 'department', 'company', 'name', 'lastLogon', 'pwdLastSet', 'accountExpires', 'logonCount', 'sAMAccountName', 'sAMAccountType', 'userPrincipalName', 'lockoutTime', 'lastLogonTimestamp', 'mail']
                };

                try {
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

                        //El registro de AD llega en entries[0]; no se documenta aqui para no dejar PII en el codigo.
                        return resolve(! entries?.[0] ? ldapServerError : {
                            code: 200,
                            status: 'success',
                            data: entries[0]
                        });
                    });
                    });
                } catch (err) {
                    console.error('LDAP search failed:', err);
                    try { client.unbind(); } catch {}
                    return resolve(ldapServerError);
                }
            });
            } catch (err) {
                console.error('LDAP bind failed:', err);
                try { client.unbind(); } catch {}
                return resolve(ldapServerError);
            }
        });

        userData.code = userData?.code || 500;

        //Los usuarios locales (ADMIN_USERNAME / ADDITIONAL_USERS) no pasan por esta función:
        //aquí solo llegan usuarios autenticados contra AD, así que todos deben estar en un grupo permitido.
        if (200 === userData.code && ! isMemberOfAllowedGroups(userData?.data?.memberOf, ldapAllowedGroups)) {
            console.warn(`LDAP user "${username}" is not a member of the allowed groups: ${ldapAllowedGroups}`);

            return {
                code: 401,
                status: 'fail',
                message: 'User does not have permission to access this resource'
            };
        }

        return userData;
    };

    http.post(endpoints.ldap, async (req, res) => {
        const userData = await authenticateLdap(req?._dataBody?.username, req?._dataBody?.password);
        const isOk = 200 === userData?.code;
        const code = isOk ? 200 : (userData?.code || 401);
        const keys = getLimiterKeys(req._clientIP, req?._dataBody?.username);

        if (isOk) {
            clearUserLimiter(keys);
        } else if (401 === code) {
            //Solo las credenciales inválidas cuentan; un fallo del servidor LDAP no debe bloquear
            await registerFailedLogin(keys);
        }

        //Respuesta mínima: nunca devolvemos el registro de AD (nombre, correo, grupos, SID...)
        res.writeHead(code, jsonHeader);
        res.end(JSON.stringify(isOk ? {code, status: 'success'} : {code, status: 'fail'}));
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
        const limiterKeys = getLimiterKeys(req._clientIP, username);
        
        if (! username || ! password) {
            invalidCredentialsObj.formErrors = {
                username: 'Invalid username',
                password: 'Invalid password'
            }

            await registerFailedLogin(limiterKeys);

            res.writeHead(invalidCredentialsObj.code, jsonHeader);
            res.end(JSON.stringify(invalidCredentialsObj));

            return;
        }

        let isUser = await validateUser(username, password);
        let authFailureCode = 401;

        if (! isUser) {
            const userDataFetch = await authenticateLdap(username, password);
            const resCode = userDataFetch?.code || 401;

            if (resCode > 199 && resCode < 300) {
                //No exponemos el registro de AD en la respuesta de login
                isUser = true;
            } else {
                authFailureCode = resCode;
            }
        }

        if (! isUser) {
            //Un error del servidor LDAP no debe consumir intentos de login
            if (401 === authFailureCode) {
                await registerFailedLogin(limiterKeys);
            }

            res.writeHead(invalidCredentialsObj.code, jsonHeader);
            res.end(JSON.stringify(invalidCredentialsObj));

            return;
        }

        if (getJWT) {
            validCredentialsObj.data.token = generateToken(username);
            validCredentialsObj.data.expiresIn = JWT_EXPIRES_IN;
            validCredentialsObj.data.timestamp = new Date().toISOString();
        }

        //Limpia solo la clave de este usuario; el contador por IP se conserva
        clearUserLimiter(limiterKeys);

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
        const {id, forceRefresh} = req?._dataBody;
        
        if (! id || ! /^\d+$/.test(id)) {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('');

            return false;
        }

        const fileData = {
            path: `${publicFolder}${capturesSubFolder}${id}.${capturesFileExten}`,
            publicPath: `${capturesSubFolder}${id}.${capturesFileExten}`,
            exists: false,
            expired: false
        }
        let  imageHeader = { 'Content-Type': capturesMimeType };
        
        imageHeader = jsonHeader;//Aquí vamos a mandar todo como json para evitar que runFetch convierta el base64 en un blob en el frontend

        const captureAge = await getCaptureAge(fileData.path);

        fileData.exists = null !== captureAge;
        fileData.expired = null === captureAge || captureAge > captureMinTimeBetweenUpdates;

        //Si la captura está vigente se sirve de disco sin llamar a HikCentral
        if (fileData.exists && ! fileData.expired) {
            try {
                const fileBuffer = await fsPromise.readFile(fileData.path);
                const base64String = fileBuffer.toString('base64');

                if (! forceRefresh) {
                    res.writeHead(200, imageHeader);
                    res.end(`${dataUriFileType}${base64String}`);
    
                    return true;
                }
            } catch (err) {
                console.error('An error occurred:', err);

                fileData.exists = false;
            }
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

    http.post(endpoints.protected.captureUpload, async (req, res) => {
        const {id, data} = req?._dataBody;
        const cameraId = String(id ?? '');
        const fail = (message) => {
            res.writeHead(200, jsonHeader);
            res.end(JSON.stringify({
                status: 'fail',
                data: message
            }));
        };

        //'string' != typeof data evita un TypeError no capturado: antes, si el
        //cliente enviaba un número u objeto, data.startsWith() tumbaba el proceso.
        if (! /^\d+$/.test(cameraId) || 'string' != typeof data || ! data.startsWith(dataUriFileType)) {
            fail('Invalid camera index code captured data');

            return;
        }

        //Solo cámaras del catálogo vigente: sin esto un JWT válido podía crear
        //archivos para ids inventados y llenar el disco.
        if (! knownCameraIds.has(cameraId)) {
            fail('Unknown camera index code');

            return;
        }

        const base64Data = data.slice(dataUriFileType.length);
        //Cota previa al decodificado: base64 ocupa ~4/3 de los bytes originales.
        const maxBase64Length = Math.ceil(captureUploadMaxBytes / 3) * 4;

        if (! base64Data.length || base64Data.length > maxBase64Length) {
            fail('Captured data size is invalid');

            return;
        }

        if (! /^[A-Za-z0-9+/]+={0,2}$/.test(base64Data)) {
            fail('Invalid captured data encoding');

            return;
        }

        const binaryData = Buffer.from(base64Data, 'base64');

        //Firma JPEG (FF D8 FF): el prefijo data:image/jpeg no garantiza que el
        //contenido sea una imagen. Sin esta comprobación se podía escribir cualquier archivo.
        if (0xFF !== binaryData[0] || 0xD8 !== binaryData[1] || 0xFF !== binaryData[2]) {
            fail('Captured data is not a JPEG image');

            return;
        }

        if (binaryData.length > captureUploadMaxBytes) {
            fail('Captured data size is invalid');

            return;
        }

        const filPath = `${publicFolder}${capturesSubFolder}${cameraId}.${capturesFileExten}`;
        const captureAge = await getCaptureAge(filPath);

        //Si la captura no existe (null) o está vencida se reescribe.
        if (null === captureAge || captureAge > captureMinTimeBetweenUpdates) {
            try {
                await fsPromise.writeFile(filPath, binaryData);
            } catch (err) {
                console.error('Error writing file:', err?.message || err);
                fail('Could not save captured data');

                return;
            }
        }

        res.writeHead(200, jsonHeader);
        res.end(JSON.stringify({
            status: 'success'
        }));
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

    //Primer catálogo antes de escuchar: capture-upload solo acepta cámaras
    //conocidas, así que se carga una vez antes de abrir el puerto.
    await refreshKnownCameraIds();

    //Iniciamos el server
    http.run();

    //Refresco de capturas en segundo plano.
    //Solo se reescriben las imágenes cuyo contenido supera el TTL, así que el ciclo
    //puede ejecutarse seguido sin volver a capturar toda la planta cada vez.
    const refreshCaptures = async () => {
        //Solo se necesitan los indexCode: getCameras() evita las llamadas de streams y PTZ
        //que hace getIntegralCameraData() y que este trabajo no usa.
        const cameraData = await hikcentral.getCameras();

        if (! cameraData?.data?.list?.length) { return; }

        const cameras = cameraData.data.list.filter((camera) => camera?.cameraIndexCode);
        const summary = {total: cameras.length, refreshed: 0, skipped: 0, failed: 0};

        //El catálogo de capture-upload se mantiene al día con la misma consulta.
        setKnownCameraIds(cameras);

        for (const camera of cameras) {
            const id = camera.cameraIndexCode;
            const filePath = `${publicFolder}${capturesSubFolder}${id}.${capturesFileExten}`;
            const age = await getCaptureAge(filePath);

            if (null !== age && age <= captureMinTimeBetweenUpdates) {
                summary.skipped += 1;

                continue;
            }

            try {
                const result = await hikcentral.getCameraCapture(id);
                const base64Data = result?.data?.data;

                if (! base64Data?.length) {
                    summary.failed += 1;
                    console.error(`Captura no disponible para la cámara ${id} (HTTP ${result?.httpStatusCode || 'sin código'})`);

                    continue;
                }

                await fsPromise.writeFile(filePath, Buffer.from(base64Data.replace(dataUriFileType, ''), 'base64'));
                summary.refreshed += 1;
            } catch (err) {
                summary.failed += 1;
                console.error(`Error actualizando la captura de la cámara ${id}:`, err?.message || err);
            }

            //Pausa entre capturas para no saturar HikCentral
            await sleep(1250);
        }

        //Resumen corto: antes se imprimía la respuesta completa (incluido el base64 de cada imagen)
        console.log(
            `Capturas: ${summary.refreshed} actualizadas, ${summary.skipped} vigentes, ` +
            `${summary.failed} fallidas de ${summary.total} cámaras ` +
            `(TTL ${formatDuration(captureMinTimeBetweenUpdates)})`
        );
    };

    //Cadena de setTimeout (no setInterval) para que dos refrescos nunca se solapen
    //y para que un error de HikCentral no tumbe el proceso ni detenga el ciclo.
    const scheduleCaptureRefresh = () => {
        setTimeout(async () => {
            try {
                await refreshCaptures();
            } catch (err) {
                console.error('Error en el refresco de capturas:', err?.message || err);
            } finally {
                scheduleCaptureRefresh();
            }
        }, captureRefreshInterval);
    };

    scheduleCaptureRefresh();

    console.log(`Refresco de capturas cada ${formatDuration(captureRefreshInterval)} (TTL ${formatDuration(captureMinTimeBetweenUpdates)})`);
})();