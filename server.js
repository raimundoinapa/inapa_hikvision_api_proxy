//Desarrollado por Raimundo Araujo - +18493768181 / https://rcsoft.club.com

(async () => {
    // Load environment variables
    require('dotenv').config();
    
    const fs = require('fs').promises;
    const jwt = require('jsonwebtoken');
    const bcrypt = require('bcryptjs');
    const httpServer = require("./http-server.js");
    const hikcentral = require('./hikcentral.js');
    const { loginRateLimiter, ipLoginRateLimiter, getClientIP, cleanup } = require('./rate-limit-config.js');

    await hikcentral.setParams();
    
    const PORT = process.env.PORT || 3000;
    const SERVER_IP = process.env.SERVER_IP || '127.0.0.1';
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
    const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';
    const users = [
        {
            username: process.env.ADMIN_USERNAME,
            passwordHash: process.env.ADMIN_PASSWORD_HASH
        }
    ];
    const additionalUsers = process.env.ADDITIONAL_USERS;

    const dbMinTimeBetweenUpdates = process.env.MIN_TIME_BETWEEN_UPDATES || 3 * 60 * 60 * 1000;//Tres horas
    const captureMinTimeBetweenUpdates = process.env.MIN_TIME_BETWEEN_CAPTURE_UPDATES || 1 * 60 * 60 * 1000;//Una hora
    const publicFolder = 'public/';
    const capturesubFolder = 'img/captures/';

    const endpoints = {
        auth: '/auth/login',
        health: '/health',
        generatehash: '/generatehash',
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

    if (additionalUsers) {
        try {
            const parsedUsers = JSON.parse(additionalUsers);
    
            users.push(...parsedUsers);
        } catch (err) {
            console.warn('Invalid ADDITIONAL_USERS format in environment variables:', err);
        }
    }

    // Generate JWT token
    const generateToken = (user) => {
        const payload = {
            username: user.username,
            iat: Math.floor(Date.now() / 1000)
        };

        return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    };

    // Validate user credentials
    const validateUser = async (username, password) => {
        const user = users.find(u => u.username === username);
        
        if (! user) { return null; }

        const isValid = await bcrypt.compare(password, user.passwordHash);

        return isValid ? user : null;
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

    const http = new httpServer({
        ip: SERVER_IP,
        port: PORT
    });

    http.use((req, res, next) => {
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        
        next();
    });

    // Login rate limiter middleware (dual-layer protection)
    http.use(async (req, res, next) => {
        if (req._url === endpoints.auth && req._RESTfulType === 'post') {
            try {
                // Check IP-only limit first (combolist protection)
                await ipLoginRateLimiter.consume(req);
                
                // Then check IP+username limit (targeted attack protection)
                await loginRateLimiter.consume(req);
                
                next();
            } catch (rejRes) {
                const timeLeft = Math.round(rejRes.msBeforeNext / 1000);
                const minutes = Math.ceil(timeLeft / 60);
                
                // Determine which limit was hit
                const isIPLimit = rejRes.keyGenerator && rejRes.keyGenerator(req) === getClientIP(req);
                const message = isIPLimit 
                    ? `Too many login attempts from this IP. Please try again in ${minutes} minutes.`
                    : `Too many login attempts for this username. Please try again in ${minutes} minutes.`;
                
                res.writeHead(429, { 
                    'Content-Type': 'application/json',
                    'Retry-After': Math.ceil(timeLeft)
                });
                res.end(JSON.stringify({
                    status: 'fail',
                    message: message,
                    retryAfter: timeLeft,
                    limitType: isIPLimit ? 'ip' : 'username'
                }));
            }
        } else {
            next();
        }
    });

    // JWT verification middleware
    http.use((req, res, next) => {
        const protectedEndpoints = Object.values(endpoints.protected);

        if (protectedEndpoints.includes(req._url) && req._RESTfulType === 'post') {
            const authHeader = req.headers['authorization'];
            const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

            if (! token) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
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
                res.writeHead(403, { 'Content-Type': 'application/json' });
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

    http.get('/shutdown', (req, res) => { http.quit(); });

    http.get(endpoints.generatehash, async (req, res) => {
        const pssword = generatePassword(10);
        const hash = await bcrypt.hash(pssword, 10);

        res.writeHead(200, jsonHeader);
        res.end(JSON.stringify({
            status: 'success',
            message: hash,
            timestamp: new Date().toISOString()
        }));
    });

    http.post(endpoints.auth, async (req, res) => {
        const username = req?._dataBody?.username;
        const password = req?._dataBody?.password;

        if (! username || ! password) {
            res.writeHead(400, jsonHeader);
            res.end(JSON.stringify({
                status: 'fail',
                message: 'Username and password are required'
            }));

            return;
        }

        const user = await validateUser(username, password);

        if (! user) {
            res.writeHead(401, jsonHeader);
            res.end(JSON.stringify({
                status: 'fail',
                message: 'Invalid credentials'
            }));

            return;
        }

        const token = generateToken(user);

        res.writeHead(200, jsonHeader);
        res.end(JSON.stringify({
            status: 'success',
            data: {
                token,
                user: { username: user.username },
                expiresIn: JWT_EXPIRES_IN
            },
            timestamp: new Date().toISOString()
        }));
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
        const result = await hikcentral.getEncodingDevices();
        
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
            path: `${publicFolder}${capturesubFolder}${id}.jpeg`,
            publicPath: `${capturesubFolder}${id}.jpeg`,
            exists: false,
            expired: false
        }

        try {
            const stats = await fs.stat(fileData.path);

            fileData.exists = true;
            fileData.expired = Date.now() - stats.birthtimeMs > captureMinTimeBetweenUpdates;
        } catch (err) {
            if (err.code === 'ENOENT') {
                //console.log(`File ${fileData.path} does not exist.`);
            } else {
                console.error('An error occurred:', err);
            }

            fileData.exists = false;
        }

        if (fileData.exists && ! fileData.expired) {
            res.writeHead(200, jsonHeader);
            res.end(fileData.publicPath);

            return true;
        }

        const result = await hikcentral.getCameraCapture(id);

        if (result?.data?.data?.length) {
            //data:image/jpeg;base64,
            const base64Data = result.data.data.replace(/^data:image\/jpeg;base64,/, '');
            const binaryData = Buffer.from(base64Data, 'base64');

            try {
                await fs.writeFile(fileData.path, binaryData);

                result.data.data = fileData.publicPath;
            } catch (err) {
                if (fileData.exists) { result.data.data = fileData.publicPath; }
            }
        }

        res.writeHead(result?.httpStatusCode || 200, jsonHeader);
        res.end(result?.data?.data || '');
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

    // Start the server
    http.run();
    
    console.log(`🚀 HikVision API Server with Dual-Layer Login Rate Limiting running on port ${PORT}`);
    console.log(`📍 Server IP: ${SERVER_IP}`);
    console.log(`🔐 IP+Username Rate Limit: 5 attempts per 15 minutes per IP:username`);
    console.log(`🌐 IP-Only Rate Limit: 50 attempts per 15 minutes per IP (combolist protection)`);
    console.log(`🌐 API endpoints: Using HikCentral's built-in rate limiting`);
})();