//Desarrollado por Raimundo Araujo - +18493768181 / https://rcsoft.club.com
//Documentación leida:
//https://www.30secondsofcode.org/articles/s/nodejs-static-file-server
//https://www.fabiofranchino.com/blog/use-electron-as-local-webserver/
//https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types/Common_types
//https://www.restapitutorial.com/lessons/httpmethods.html#:~:text=The%20primary%20or%20most%2Dcommonly,but%20are%20utilized%20less%20frequently.

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
        this.public = options.public || path.normalize(path.resolve(__dirname, 'public'));
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
        this.sockets = [];
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

        this.getClientIP = (req) => {
            //Cabacera reenviadas (para escenarios de proxy o balanceador de carga)
            const forwarded = req.headers['x-forwarded-for'];
            
            if (forwarded) {
                return forwarded.split(',')[0].trim();
            }
            
            const realIP = req.headers['x-real-ip'];
            
            if (realIP) { return realIP; }
        
            //Fallback a remoteAddress
            const reqConn = req?.connection;

            return reqConn?.remoteAddress || req?.socket?.remoteAddress || reqConn?.socket?.remoteAddress || 'unknown';
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
    
                //El evento 'data' se ejecuta cada vez que se recibe un trozo de información. La almacenamos en un array.
                req.on("data", (chunk) => {
                    totalSize += chunk.length;
                    
                    if (totalSize > this.maxPostSize) {
                        return resolve({httpStatusCode: 413});
                    }
                    
                    chunks.push(chunk);
                });
    
                //El evento 'end' se ejecuta cuando se han recibido todos los trozos de información
                req.on("end", () => {
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

                        return resolve(data);
                    }
    
                    const bufferString = data.toString('utf8');//Convertimos el buffer en una cadena parecida al querystring en una URL

                    if (bufferString) {
                        if (req._contentType && req._contentType.indexOf('x-www-form') + 1) {
                            const parsedData = new URLSearchParams(bufferString);//Convertimos el querystring en un objeto para iterarlo
            
                            for (let pair of parsedData.entries()) { dataObj[pair[0]] = pair[1]; }
            
                            return resolve(dataObj); 
                        }

                        //Intentamos convertir el resultado en un objeto json
                        try {
                            const result = JSON.parse(bufferString);

                            return resolve(result);
                        } catch(e) {
                            //console.log(e);
                        } finally {}
                        
                        return resolve(bufferString);
                    }
    
                    return resolve(false);
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
            req._fileName = path.basename(req._url);
            req._extension = req._fileName && /\./.test(req._fileName) ? path.extname(req._fileName).slice(1) : '';//Le quita el punto a la extensión
            req._fileType = this.mimeTypes?.[req._extension] || this.mimeTypes?.[Object.keys(this.mimeTypes)[Object.values(this.mimeTypes).indexOf(req.headers['content-type'])]] || this.mimeTypes.octetStream;
            req._contentType = req.headers['content-type'] || '';
            req._isMultipart = req._contentType.startsWith('multipart/form-data') || req._contentType.includes(this.mimeTypes.octetStream) || req.headers['x-file-name'] || req.headers['x-file-size'] || req.headers['x-chunk-index'];
            req._contentLength = parseInt(req.headers['content-length'] || '0');
            req._dataBody = ! req._isPost ? req._qsEntries : await this.getPostBody(req);

            //console.log(req._method, req.url, req._qs, req._qsEntries, req._isPost, req._isBackendRequest, req._filePath, req._fileName, req._extension, req._fileType, req._contentType, req._isMultipart, req._contentLength, req._dataBody);

            req.on('error', (err) => {
                console.error('Request error:', err?.code, err?.message, err?.syscall, err?.hostname);

                //A veces SSE genera un error, pero ya ha mandado cabeceras
                if (! res.headersSent) {
                    req.destroy();

                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        status: 'fail',
                        message: 'Request error'
                    }));
                }

                return;
            });

            if ('options' == req._method) {
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', this.RESTfulVerbs.join(', ').toUpperCase());
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-File-Name, X-File-Size, X-Chunk-Index, X-Total-Chunks');
                res.writeHead(200);//Enviamos HTTP 200 para el preflight
                res.end();

                return;
            }

            if ((req?._contentLength && req._contentLength > this.maxPostSize) || 413 == req?._dataBody?.httpStatusCode) {
                req.destroy();
                
                res.writeHead(413, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({
                    status: 'fail',
                    message: `Post size exceeds maximum limit of ${this.maxPostSize / 1024 / 1024}MB`
                }));

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

        this.quit = async () => {
            console.log(`Closing http server`);

            //Para realizar algun tipo de operación antes de apagar el server
            if (this.onExit) { await this.onExit(); }
			
			this.server.close((err) => {
				if (err) {
					console.error('Server close error:', err);
					
					process.exit(1);//Si hay error intentamos cerrar el server forzadamente
				}
				
				for (const s of this.sockets) {
					s.destroy();
				}

				this.sockets = [];

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
            
            this.server.listen(this.port, () => {
                console.log(`🚀 HTTP server is listening on ${this.host}`);

                this.server.on('connection', (s) => {
                    this.sockets.push(s);
    
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