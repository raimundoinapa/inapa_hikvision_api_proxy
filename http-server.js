//Desarrollado por Raimundo Araujo - +18493768181 / https://rcsoft.club.com
//Documentación leida:
//https://www.30secondsofcode.org/articles/s/nodejs-static-file-server
//https://www.fabiofranchino.com/blog/use-electron-as-local-webserver/
//https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types/Common_types
//https://www.restapitutorial.com/lessons/httpmethods.html#:~:text=The%20primary%20or%20most%2Dcommonly,but%20are%20utilized%20less%20frequently.

//Un puerto TCP solo habla un protocolo. Para aceptar https y http en el mismo puerto
//miramos el primer byte: 0x16 es un handshake TLS (pasa al servidor https) y
//cualquier otra cosa es HTTP plano (se responde con un redirect a https).
const isTlsHandshake = (chunk) => chunk?.length > 0 && 0x16 === chunk[0];

//Normaliza la IP para usarla como clave: ::ffff:1.2.3.4 -> 1.2.3.4
const normalizeClientIP = (ip = '') => {
    const value = String(ip).trim();

    if (value.startsWith('::ffff:')) { return value.slice(7); }
    if ('::1' === value) { return '127.0.0.1'; }

    return value;
};

const stripPort = (host = '') => {
    const value = String(host).trim();

    if (value.startsWith('[')) {
        const end = value.indexOf(']');

        return end === -1 ? value : value.slice(0, end + 1);
    }

    return value.split(':')[0];
};

const parseRequestHead = (buffer) => {
    const lines = buffer.toString('latin1').split('\r\n');
    const [rawMethod = 'GET', rawTarget = '/'] = (lines[0] || '').split(' ');
    const hostLine = lines.find((line) => /^host\s*:/i.test(line));
    const host = hostLine ? hostLine.slice(hostLine.indexOf(':') + 1).trim() : '';

    let target = rawTarget;

    //Formato absoluto (proxies): http://host/ruta -> /ruta
    if (/^https?:\/\//i.test(target)) {
        try {
            const parsed = new URL(target);

            target = `${parsed.pathname}${parsed.search}`;
        } catch {
            target = '/';
        }
    }

    //Evita inyectar CRLF o caracteres de control en el header Location
    if (! /^\/[\x20-\x7e]*$/.test(target)) {
        target = '/';
    }

    return {
        method: String(rawMethod).toUpperCase(),
        target,
        host: stripPort(host).toLowerCase()
    };
};

class httpServer {
    constructor(options = {protocol: 'https', ip: '', port: '', root: ''}) {
        const fs = require('fs');
        const path = require('path');
        const certPath = path.join(__dirname, 'ssl');
        const keyFile = process.env?.SSL_KEY || options?.key || path.join(certPath, 'server.key');
        const certFile = process.env?.SSL_CERT || options?.cert || path.join(certPath, 'server.crt');
        const certsExist = fs.existsSync(keyFile) && fs.existsSync(certFile);
        const protocol = options?.protocol || (! certsExist ? 'http' : 'https');
        const http = require(protocol);

        this.ip = options.ip || '127.0.0.1';
        this.port = options.port || 8080;
        this.host = `${protocol}://${this.ip}:${this.port}/`;
        this.public = path.resolve(__dirname, options.public || 'public');
        this.protocol = protocol;
        this.secure = certsExist && 'https' == protocol;
        //Solo se aceptan X-Forwarded-For / X-Real-IP si la conexión directa viene
        //de un proxy configurado (TRUST_PROXY). Sin proxy, la IP del socket manda.
        this.trustedProxies = new Set(
            (Array.isArray(options.trustedProxies) ? options.trustedProxies : String(options.trustedProxies || '').split(','))
                .map(normalizeClientIP)
                .filter(Boolean)
        );
        this.trustAllProxies = this.trustedProxies.has('*');
        this.redirectHttpToHttps = this.secure && 'false' != String(process.env?.REDIRECT_HTTP_TO_HTTPS ?? 'true').toLowerCase();
        this.listener = null;
        this.allowedHosts = new Set([
            String(this.ip).toLowerCase(),
            'localhost',
            '127.0.0.1',
            '::1',
            '[::1]',
            String(require('os').hostname()).toLowerCase(),
            ...String(process.env?.HTTP_REDIRECT_ALLOWED_HOSTS || '')
                .split(',')
                .map((h) => h.trim().toLowerCase())
                .filter(Boolean)
        ]);
        this.mimeTypes = {
            text: 'text/plain',
            html: 'text/html',
            css: 'text/css',
            js: 'application/javascript',
            mjs: 'application/javascript',
            json: 'application/json',
            map: 'application/json',
            svg: 'image/svg+xml',
            png: 'image/png',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            gif: 'image/gif',
            ico: 'icon/x-icon',
            xml: 'application/xml',
            pdf: 'application/pdf',
            xls: 'application/vnd.ms-excel',
            doc: 'application/msword',
            zip: 'application/zip',
            mp3: 'audio/mpeg',
            mp4: 'video/mp4',
            weba: 'audio/webm',
            webm: 'video/webm',
            ttf: 'font/ttf',
            otf: 'font/otf',
            woff: 'font/woff',
            woff2: 'font/woff2',
            wasm: 'application/wasm',
            octetStream: 'application/octet-stream',//Para cualquier tipo de archivo binario
        };
        this.RESTfulVerbs = ['get', 'post', 'put', 'patch', 'delete', 'options'];
        this.maxPostSize = process.env.MAX_POST_SIZE || 10 * 1024 * 1024;//10MB
        this.sockets = new Set();
        this.middlewares = [];
        this.notFoundEndpoint = false;
        //this.getEndpoints = {}
        //this.get = (endpoint = '', fnc = () => {}) => {
            //this.getEndpoints[endpoint] = fnc;
        //}

        for (let r = 0; r < this.RESTfulVerbs.length; r++) {
            const verb = this.RESTfulVerbs[r];

            this[`${verb}Endpoints`] = {};

            this[verb] = (endpoint = '', fnc = () => {}) => {
                this[`${verb}Endpoints`][endpoint] = fnc;
            }
        }

        this.use = (middleware) => {
            this.middlewares.push(middleware);
        };

        this.isTrustedProxy = (ip) => this.trustAllProxies || this.trustedProxies.has(normalizeClientIP(ip));

        this.getClientIP = (req) => {
            const reqConn = req?.connection || req?.socket;
            const remoteAddress = normalizeClientIP(reqConn?.remoteAddress || req?.socket?.remoteAddress || 'unknown');

            //Conexión directa: las cabeceras reenviadas las puede inventar el cliente.
            if (! this.isTrustedProxy(remoteAddress)) { return remoteAddress; }

            const forwarded = req.headers['x-forwarded-for'];

            if (forwarded) {
                const hops = String(forwarded).split(',').map(normalizeClientIP).filter(Boolean);

                //De derecha a izquierda: el primer salto que no sea un proxy conocido es el cliente.
                for (let i = hops.length - 1; i >= 0; i--) {
                    if (! this.isTrustedProxy(hops[i])) { return hops[i]; }
                }
            }

            const realIP = req.headers['x-real-ip'];

            if (realIP) { return normalizeClientIP(realIP); }

            return remoteAddress;
        }

        this.getQueryStringEntries = (qs) => {
            const entries = {};

            if (! qs) { return entries; }

            const sp = new URLSearchParams(qs);

            for(const e of sp.entries()) { entries[e[0]] = e[1]; }

            return entries;
        }
        
        this.getPostBody = (req) => {
            return new Promise((resolve) => {
                let totalSize = 0;
                let chunks = [];
                let dataObj = {};
                let settled = false;

                //Resuelve una sola vez. Necesario porque un request abortado puede
                //disparar 'aborted' y 'error' además de (o en vez de) 'end'.
                const settle = (value) => {
                    if (settled) { return; }

                    settled = true;
                    resolve(value);
                };

                //Si el cliente corta la conexión a mitad del body, 'end' nunca llega.
                //Sin estos listeners la promesa quedaba pendiente para siempre y el
                //handler del endpoint se quedaba colgado.
                req.once('aborted', () => settle(null));
                req.once('error', () => settle(null));

                //El evento 'data' se ejecuta cada vez que se recibe un trozo de información. La almacenamos en un array.
                req.on("data", (chunk) => {
                    if (settled) { return; }

                    totalSize += chunk.length;
                    
                    if (totalSize > this.maxPostSize) {
                        return settle({httpStatusCode: 413});
                    }
                    
                    chunks.push(chunk);
                });
    
                //El evento 'end' se ejecuta cuando se han recibido todos los trozos de información
                req.on("end", () => {
                    if (settled) { return; }

                    const data = Buffer.concat(chunks);//Creamos un Buffer con todos los trozos de información (lo mismo que Buffer.from(chunks.join("")))

                    if (req._isMultipart) {
                        const dataToInspect = data.toString('utf8').slice(0, 300);
                        const boundaryMatch = dataToInspect.match(/boundary=(.+)$/);
                        
                        if (! boundaryMatch) {
                            //fs.writeFileSync(filepath, data);
                        } else {
                            //Lógica de bounderies para multipart/form-data
                            //const boundary = boundaryMatch[1];
                            //const parts = [];
                            //const boundaryBuffer = Buffer.from(`--${boundary}`);
                            //const endBoundaryBuffer = Buffer.from(`--${boundary}--`);
                        }                        

                        return settle(data);
                    }
    
                    const bufferString = data.toString('utf8');//Convertimos el buffer en una cadena parecida al querystring en una URL

                    if (bufferString) {
                        if (req._contentType && req._contentType.indexOf('x-www-form') + 1) {
                            const parsedData = new URLSearchParams(bufferString);//Convertimos el querystring en un objeto para iterarlo
            
                            for (let pair of parsedData.entries()) { dataObj[pair[0]] = pair[1]; }
            
                            return settle(dataObj); 
                        }

                        //Intentamos convertir el resultado en un objeto json
                        try {
                            const result = JSON.parse(bufferString);

                            return settle(result);
                        } catch(e) {
                            //console.log(e);
                        } finally {}
                        
                        return settle(bufferString);
                    }
    
                    return settle(false);
                });
            });
        }

        this.requestHaldler = async (req, res) => {
            let middlewareIndex = 0;

            req._clientIP = this.getClientIP(req);
            req._method = req.method.toLowerCase();
            req._url = ! /\/$/.test(req.url) ? req.url.split('?')[0] : req.url + 'index.html';//Si el request termina en / asumimos que es un index.html
            req._qs = req.url.split('?')?.[1] || '';
            req._qsEntries = this.getQueryStringEntries(req._qs);
            req._isPost = 'get' != req._method;
            req._isBackendRequest = req._isPost || Object.keys(req._qsEntries);
            req._filePath = path.join(this.public, req._url);

            //Rechaza rutas que escapen de la carpeta pública (path traversal)
            if (req._filePath !== this.public && ! req._filePath.startsWith(this.public + path.sep)) {
                res.writeHead(404, {'Content-Type': 'text/html'});
                res.end('404: File not found');

                return;
            }

            req._fileName = path.basename(req._url);
            req._extension = req._fileName && /\./.test(req._fileName) ? path.extname(req._fileName).slice(1) : '';//Le quita el punto a la extensión
            req._fileType = this.mimeTypes?.[req._extension] || this.mimeTypes?.[Object.keys(this.mimeTypes)[Object.values(this.mimeTypes).indexOf(req.headers['content-type'])]] || this.mimeTypes.octetStream;
            req._contentType = req.headers['content-type'] || '';
            req._isMultipart = req._contentType.startsWith('multipart/form-data') || req._contentType.includes(this.mimeTypes.octetStream) || req.headers['x-file-name'] || req.headers['x-file-size'] || req.headers['x-chunk-index'];
            req._contentLength = parseInt(req.headers['content-length'] || '0');

            //El listener se registra ANTES de leer el body: si el cliente corta la
            //conexión durante la subida, el request emite 'error' mientras todavía
            //estamos esperando los datos. Antes se registraba después del await, así
            //que ese error no tenía manejador y el handler quedaba colgado.
            req.on('error', (err) => {
                console.error('Request error:', err?.code, err?.message, err?.syscall, err?.hostname);

                //A veces SSE genera un error, pero ya ha mandado cabeceras
                if (! res.headersSent) {
                    //Se responde antes de destruir el socket: al revés, el 400 podía
                    //no llegar nunca al cliente.
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        status: 'fail',
                        message: 'Request error'
                    }));
                }

                req.destroy();

                return;
            });

            req._dataBody = ! req._isPost ? req._qsEntries : await this.getPostBody(req);

            //console.log(req._method, req.url, req._qs, req._qsEntries, req._isPost, req._isBackendRequest, req._filePath, req._fileName, req._extension, req._fileType, req._contentType, req._isMultipart, req._contentLength, req._dataBody);

            //El request falló o el cliente abortó: ya se respondió (o se responde
            //aquí) y no hay body que entregar al router.
            if (res.writableEnded) { return; }

            if (req._isPost && null === req._dataBody) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'fail',
                    message: 'Request body could not be read'
                }));

                return;
            }

            if ('options' == req._method) {
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', this.RESTfulVerbs.join(', ').toUpperCase());
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-File-Name, X-File-Size, X-Chunk-Index, X-Total-Chunks, X-Screen-Key');
                res.writeHead(200);//Enviamos HTTP 200 para el preflight
                res.end();

                return;
            }

            if ((req?._contentLength && req._contentLength > this.maxPostSize) || 413 == req?._dataBody?.httpStatusCode) {
                //Se responde antes de destruir el socket: al revés, el cliente recibía
                //ECONNRESET en lugar del 413.
                res.writeHead(413, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({
                    status: 'fail',
                    message: `Post size exceeds maximum limit of ${this.maxPostSize / 1024 / 1024}MB`
                }), () => { req.destroy(); });

                return;
            }
            
            const next = () => {
                if (! req) { return; }

                if (middlewareIndex < this.middlewares.length) {
                    this.middlewares[middlewareIndex++](req, res, next);
                } else {
                    if (this?.respond) {
                        this.respond(req, res);//Extender la clase añadiendo funcionalidad a este método
        
                        return;
                    }
                    
                    for (let r = 0; r < this.RESTfulVerbs.length; r++) {
                        const verb = this.RESTfulVerbs[r];
                        const endpoint = this?.[`${verb}Endpoints`]?.[req._url];

                        if (verb == req._method && endpoint) {
                            //console.log(req._url);

                            endpoint(req, res);
            
                            return;
                        }
                    }

                    fs.readFile(req._filePath, (err, data) => {
                        //console.log(req._filePath);
                        
                        if (err) {
                            if (this?.notFoundEndpoint) {
                                this.notFoundEndpoint(req, res);

                                return;
                            }
                            
                            res.writeHead(404, {'Content-Type': 'text/html'});
                            res.end('404: File not found');

                            return;
                        }
                
                        res.writeHead(200, {'Content-Type': req._fileType});
                        res.end(data);

                        return;
                    });
                }
            };

            next();
        };

        this.server = ! certsExist ? http.createServer(this.requestHaldler) : http.createServer({
            key: fs.readFileSync(keyFile),
            cert: fs.readFileSync(certFile),
        }, this.requestHaldler);

        const net = require('net');

        //Host de destino: aceptamos el IP del servidor, IPs literales o hosts permitidos.
        //Si el Host no es confiable usamos SERVER_IP para no crear un open redirect.
        this.getRedirectHost = (requestHost = '') => {
            const host = String(requestHost).toLowerCase();
            const unbracketed = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;

            if (host && (this.allowedHosts.has(host) || net.isIP(unbracketed))) {
                return host;
            }

            return String(this.ip).toLowerCase();
        };

        this.getRedirectLocation = (requestHost = '', target = '/') => {
            const host = this.getRedirectHost(requestHost);
            const port = '443' == String(this.port) ? '' : `:${this.port}`;

            return `https://${host}${port}${target}`;
        };

        //Responde el redirect a una petición HTTP plana
        this.redirectToHttps = (socket, buffer) => {
            const { method, target, host } = parseRequestHead(buffer);
            const location = this.getRedirectLocation(host, target);
            const status = ['GET', 'HEAD'].includes(method) ? 301 : 308;//308 conserva método y body
            const reason = 301 == status ? 'Moved Permanently' : 'Permanent Redirect';

            if (! socket.destroyed) {
                socket.end(`HTTP/1.1 ${status} ${reason}\r\nLocation: ${location}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: 0\r\n\r\n`);
            }
        };

        //Primer byte: TLS -> servidor https; HTTP plano -> redirect
        this.handleIncoming = (socket) => {
            this.sockets.add(socket);
            socket.once('close', () => { this.sockets.delete(socket); });

            socket.on('error', () => {});//Evita unhandled 'error' si el cliente corta la conexión

            socket.once('data', (chunk) => {
                if (socket.destroyed) {
                    return;
                }

                if (isTlsHandshake(chunk)) {
                    socket.pause();
                    socket.unshift(chunk);
                    this.server.emit('connection', socket);
                    //No hacemos resume(): el servidor TLS toma el control y reanuda el socket él mismo.
                    //Reanudar aquí entrega el ClientHello antes de que TLS instale sus handlers.

                    return;
                }

                socket.pause();

                let buffer = chunk;
                const timer = setTimeout(() => {
                    if (! socket.destroyed) {
                        socket.destroy();
                    }
                }, 5000);

                timer.unref();

                const finish = () => {
                    clearTimeout(timer);
                    socket.removeListener('data', onData);
                    this.redirectToHttps(socket, buffer);
                };

                const onData = (more) => {
                    buffer = Buffer.concat([buffer, more]);

                    if (buffer.includes('\r\n\r\n') || buffer.length > 16384) {
                        finish();
                    }
                };

                if (buffer.includes('\r\n\r\n') || buffer.length > 16384) {
                    finish();

                    return;
                }

                socket.on('data', onData);
                socket.resume();
            });
        };

        this.quit = async () => {
            console.log(`Closing http server`);

            //Para realizar algun tipo de operación antes de apagar el server
            if (this.onExit) { await this.onExit(); }

            //El listener TCP (redirect http->https) y el servidor https deben cerrarse por separado
            if (this.listener && this.listener !== this.server) {
                try {
                    this.listener.close();
                } catch {}
            }

            const closeMain = (callback) => {
                if (! this.server.listening) {
                    callback();

                    return;
                }

                this.server.close(callback);
            };

            closeMain((err) => {
                if (err) {
                    console.error('Server close error:', err);
                    
                    process.exit(1);//Si hay error intentamos cerrar el server forzadamente
                }
                
                for (const s of this.sockets) {
                    s.destroy();
                }

                this.sockets.clear();

                console.log(`http server closed`);
                
                process.exit(0);
            });
            
            //Forzamos el cierre de process en 5 segundos, si ya esta cerrado, Node ignora este comando
            setTimeout(() => process.exit(1), 5000).unref();
        }
        
        this.run = () => {
            if (this?.getEndpoints?.['/404']) {
                this.notFoundEndpoint = this.getEndpoints['/404'];
            }

            //Con https, escuchamos con un multiplexor para redirigir el HTTP plano al mismo puerto
            this.listener = this.redirectHttpToHttps
                ? require('net').createServer((socket) => this.handleIncoming(socket))
                : this.server;
            
            this.listener.listen(this.port, () => {
                console.log(`🚀 HTTP server is listening on ${this.host}`);

                if (this.redirectHttpToHttps) {
                    console.log(`HTTP->HTTPS redirect enabled on port ${this.port}`);
                }

                this.server.on('connection', (s) => {
                    this.sockets.add(s);
    
                    //this.server.once('close', () => { s.destroy(); });
                });
            });

            //Shutdown con Ctrl+C ó Ctrl+\
            process.on('SIGINT', async () => { this.quit(); });
            
            //Shutdown con Ctrl+C
            process.on('SIGTERM', async () => { this.quit(); });
        }
    }
}

module.exports = httpServer;