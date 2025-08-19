//https://www.30secondsofcode.org/articles/s/nodejs-static-file-server
//https://www.fabiofranchino.com/blog/use-electron-as-local-webserver/
//https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types/Common_types
//https://www.restapitutorial.com/lessons/httpmethods.html#:~:text=The%20primary%20or%20most%2Dcommonly,but%20are%20utilized%20less%20frequently.

class httpServer {
    constructor(options = {protocol: '', ip: '', port: '', root: ''}) {
        const http = require('http');
        const path = require('path');
        
        this.protocol = options.protocol || 'http';
        this.ip = options.ip || '127.0.0.1';
        this.port = options.port || 8080;
        this.host = `${this.protocol}://${this.ip}:${this.port}/`;
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
            mp3: 'audio/mpeg',
            mp4: 'video/mp4',
            weba: 'audio/webm',
            webm: 'video/webm',
            ttf: 'font/ttf',
            otf: 'font/otf',
            woff: 'font/woff',
            woff2: 'font/woff2',
            wasm: 'application/wasm',
            octetStream: 'application/octet-stream',
            rowBinaryData: 'multipart/form-data'
        };
        this.RESTful = ['get', 'post', 'put', 'patch', 'delete', 'options'];//Similar a Create, Read, Update, Delete (CRUD)
        this.sockets = [];
        this.getEndpoints = {};
        this.postEndpoints = {};
        this.middlewares = [];
        this.server = http.createServer(async (req, res) => {
            const fs = require('fs');

            const getQueryStringEntries = (qs) => {
                const sp = new URLSearchParams(qs);
                const entries = {};

                for(const e of sp.entries()) { entries[e[0]] = e[1]; }

                return entries;
            }
            
            const getPostBody = () => {
                return new Promise((resolve) => {
                    let chunks = [];
                    let dataObj = {};
        
                    //El evento 'data' se ejecuta cada vez que se recibe un trozo de información. La almacenamos en un array.
                    req.on("data", (chunk) => { chunks.push(chunk); });
        
                    //El evento 'end' se ejecuta cuando se han recibido todos los trozos de información
                    req.on("end", () => {
                        const data = Buffer.concat(chunks);//Creamos un Buffer con todos los trozos de información (lo mismo que Buffer.from(chunks.join("")))
        
                        const bufferString = data.toString();//Convertimos el buffer en una cadena parecida al querystring en una URL
        
                        //const parsedData = new URLSearchParams(bufferString);//Convertimos el querystring en un objeto para iterarlo (lo mismo que xxx)
        
                        //for (let pair of parsedData.entries()) { dataObj[pair[0]] = pair[1]; }
        
                        //if (dataObj) { resolve(dataObj); }

                        if (bufferString) {
                            try {
                                const result = JSON.parse(bufferString);

                                resolve(result);
                            } catch(e) {
                                //console.log(e);
                            } finally {}
                            
                            resolve(bufferString);
                        }
        
                        resolve(false);
                    });
                });
            }

            let middlewareIndex = 0;

            const urlQuery = /\?/.test(req.url) ? req.url.split('?') : [];

            req._url = ! /\/$/.test(req.url) ? ! urlQuery?.length ? req.url : urlQuery[0] : req.url + 'index.html';//Si el request termina en / asumimos que es un index.html
            req._qsEntries = ! urlQuery?.length || ! urlQuery[1] ? {} : getQueryStringEntries(urlQuery[1]);
            req._isPost = 'get' != req.method.toLowerCase();
            req._isBackendRequest = req._isPost || Object.keys(req._qsEntries);
            req._filePath = path.join(this.public, req._url);
            req._fileName = path.basename(req._url);
            req._extension = req._fileName && /\./.test(req._fileName) ? path.extname(req._fileName).slice(1) : '';//Le quita el punto a la extensión
            req._fileType = this.mimeTypes[Object.keys(this.mimeTypes)[Object.values(this.mimeTypes).indexOf(req.headers['content-type'])]] || this.mimeTypes[req._extension] || this.mimeTypes.octetStream;
            req._isFileUpload = req._isPost && (req._fileType == this.mimeTypes.octetStream || req._fileType == this.mimeTypes.rowBinaryData);
            req._RESTfulType = this.RESTful[this.RESTful.indexOf(req.method.toLowerCase())];
            req._dataBody = ! req._isPost ? req._qsEntries : await getPostBody();

            //console.log(req.url, req._qsEntries, req._isPost, req._isBackendRequest, req._filePath, req._fileName, req._extension, req._fileType, req._isFileUpload, req._RESTfulType, req._dataBody);

            if ('options' == req._RESTfulType) {
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
                res.writeHead(200);//Enviamos HTTP 200 para el preflight
                res.end();

                return;
            }

            const next = () => {
                if (middlewareIndex < this.middlewares.length) {
                    this.middlewares[middlewareIndex++](req, res, next);
                } else {
                    if (req._isPost && this.postEndpoints[req._url]) {
                        this.postEndpoints[req._url](req, res);
        
                        return;
                    }
        
                    if (! req._isPost && this.getEndpoints[req._url]) {
                        this.getEndpoints[req._url](req, res);
        
                        return;
                    }
        
                    if (this.respond) {
                        this.respond(req, res);//Extender la clase añadiendo funcionalidad a este método
        
                        return;
                    }
                
                    fs.readFile(req._filePath, (err, data) => {
                        console.log(req._filePath);
                        
                        if (err) {
                            res.writeHead(404, {'Content-Type': 'text/html'});
                            res.end('404: File not found');
                
                            return;
                        }
                
                        res.writeHead(200, {'Content-Type': req._fileType });
                        res.end(data);

                        return;
                    });
                }
            };

            next();
        });

        this.use = (middleware) => {
            this.middlewares.push(middleware);
        };

        this.get = (endpoint = '', fnc = () => {}) => {
            this.getEndpoints[endpoint] = fnc;
        }

        this.post = (endpoint = '', fnc = () => {}) => {
            this.postEndpoints[endpoint] = fnc;
        }
        
        this.run = () => {
            this.server.listen(this.port, () => {
                console.log(`HTTP server is listening on ${this.host}`);

                this.server.on('connection', (s) => {
                    this.sockets.push(s);
    
                    //server.once('close', () => { sockets.delete(socket); });
                });
            });
        }
        
        this.quit = () => {
            console.log(`Closing http server`);

            return new Promise((resolve) => {
                this.server.close(() => {
                    for (const s of this.sockets) {
                        s.destroy();
                        //sockets.delete(socket);
                    }
    
                    this.sockets = [];
    
                    console.log(`http server closed`);

                    resolve(true);
                });
            });
        }
    }
}

module.exports = httpServer;