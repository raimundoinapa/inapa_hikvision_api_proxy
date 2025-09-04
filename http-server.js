//Desarrollado por Raimundo Araujo - +18493768181 / https://rcsoft.club.com
//Documentación leida:
//https://www.30secondsofcode.org/articles/s/nodejs-static-file-server
//https://www.fabiofranchino.com/blog/use-electron-as-local-webserver/
//https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types/Common_types
//https://www.restapitutorial.com/lessons/httpmethods.html#:~:text=The%20primary%20or%20most%2Dcommonly,but%20are%20utilized%20less%20frequently.

class httpServer {
    constructor(options = {protocol: '', ip: '', port: '', root: ''}) {
        const http = require('http');
        const fs = require('fs');
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
        this.RESTful = ['get', 'post', 'put', 'patch', 'delete', 'options'];
        this.maxPostSize = process.env.MAX_POST_SIZE || 10 * 1024 * 1024;//10MB
        this.sockets = [];
        this.middlewares = [];

        //this.getEndpoints = {}
        //this.get = (endpoint = '', fnc = () => {}) => {
            //this.getEndpoints[endpoint] = fnc;
        //}
        for (let r = 0; r < this.RESTful.length; r++) {
            const verb = this.RESTful[r];

            this[`${verb}Endpoints`] = {};

            this[verb] = (endpoint = '', fnc = () => {}) => {
                this[`${verb}Endpoints`][endpoint] = fnc;
            }
        }

        this.use = (middleware) => {
            this.middlewares.push(middleware);
        };

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

                    if (req._isFileUpload) {
                        const boundaryMatch = req._contentType.match(/boundary=(.+)$/);
                        
                        if (! boundaryMatch) {
                            //Aquí req._contentType es un application/octet-stream o algo como image/jpeg, etc. con x-file-name, x-file-size, etc.
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
    
                    const bufferString = data.toString();//Convertimos el buffer en una cadena parecida al querystring en una URL
    
                    //const parsedData = new URLSearchParams(bufferString);//Convertimos el querystring en un objeto para iterarlo
    
                    //for (let pair of parsedData.entries()) { dataObj[pair[0]] = pair[1]; }
    
                    //if (dataObj) { resolve(dataObj); }

                    if (bufferString) {
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

        this.server = http.createServer(async (req, res) => {
            let middlewareIndex = 0;

            req._method = req.method.toLowerCase();
            req._url = ! /\/$/.test(req.url) ? req.url.split('?')?.[0] : req.url + 'index.html';//Si el request termina en / asumimos que es un index.html
            req._qs = req.url.split('?')?.[1] || '';
            req._qsEntries = this.getQueryStringEntries(req._qs);
            req._isPost = 'get' != req._method;
            req._isBackendRequest = req._isPost || Object.keys(req._qsEntries);
            req._filePath = path.join(this.public, req._url);
            req._fileName = path.basename(req._url);
            req._extension = req._fileName && /\./.test(req._fileName) ? path.extname(req._fileName).slice(1) : '';//Le quita el punto a la extensión
            req._fileType = this.mimeTypes?.[req._extension] || this.mimeTypes?.[Object.keys(this.mimeTypes)[Object.values(this.mimeTypes).indexOf(req.headers['content-type'])]] || this.mimeTypes.octetStream;
            req._contentType = req.headers['content-type'] || '';
            req._isFileUpload = req._contentType.startsWith('multipart/form-data') || req._contentType.includes(this.mimeTypes.octetStream) || req.headers['x-file-name'] || req.headers['x-file-size'] || req.headers['x-chunk-index'];
            req._contentLength = parseInt(req.headers['content-length'] || '0');
            req._dataBody = ! req._isPost ? req._qsEntries : await this.getPostBody(req);

            //console.log(req._method, req.url, req._qs, req._qsEntries, req._isPost, req._isBackendRequest, req._filePath, req._fileName, req._extension, req._fileType, req._contentType, req._isFileUpload, req._contentLength, req._dataBody);

            /*
            //Ejemplo de formulario para subir un archivo

            <form action="/upload" method="post" enctype="multipart/form-data" target="formResult">
                <input type="file" name="file" id="file">
                <input type="text" name="description" id="description">
                <button type="submit">Upload</button>
            </form>

            <script>
                document.getElementById('file').addEventListener('change', async (e) => {
                    const file = e.target.files[0];

                    if (! file) { return; }

                    const formData = new FormData();
                
                    formData.append('file', file);
                    formData.append('description', 'Description of the file');

                    //Enviando el formData con fetch
                    try {
                        const response = await fetch('/upload', {
                            method: 'POST',
                            body: formData
                        });

                        //
                    } catch (error) {
                        console.error('Upload error:', error);
                    }

                    //Enviando el formData con XMLHttpRequest
                    const xhr = new XMLHttpRequest();
                    xhr.open('POST', '/upload', true);
                    xhr.upload.onprogress = function(e) {
                        if (e.lengthComputable) {
                            const percentComplete = Math.round((e.loaded / e.total) * 100);
                        }
                    };
                    xhr.onload = function() {};
                    xhr.onerror = function() {};
                    xhr.send(formData);

                    //Enviando el file con fetcha row
                    try {
                        const response = await fetch('/upload', {
                            method: 'POST',
                            headers: {
                                'Content-Type': file.type,
                                'X-File-Name': file.name,
                                'X-File-Size': file.size.toString()
                            },
                            body: file
                        });

                        //
                    } catch (error) {
                        console.error('Upload error:', error);
                    }
                });
            </script>
            */

            req.on('error', (error) => {
                console.error('Request error:', error);

                req.destroy();

                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'fail',
                    message: 'Request error'
                }));

                return;
            });

            if ('options' == req._method) {
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', this.RESTful.join(', ').toUpperCase());
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
                    if (this.respond) {
                        this.respond(req, res);//Extender la clase añadiendo funcionalidad a este método
        
                        return;
                    }
                    
                    for (let r = 0; r < this.RESTful.length; r++) {
                        const verb = this.RESTful[r];
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
        });

        this.quit = () => {
            console.log(`Closing http server`);

            return new Promise((resolve) => {
                this.server.close(() => {
                    for (const s of this.sockets) {
                        s.destroy();
                    }
    
                    this.sockets = [];
    
                    console.log(`http server closed`);

                    resolve(true);
                });
            });
        }
        
        this.run = () => {
            this.server.listen(this.port, () => {
                console.log(`HTTP server is listening on ${this.host}`);

                this.server.on('connection', (s) => {
                    this.sockets.push(s);
    
                    //this.server.once('close', () => { s.destroy(); });
                });
            });

            // Graceful shutdown
            process.on('SIGTERM', async () => {
                await this.quit();

                process.exit(0);
            });

            process.on('SIGINT', async () => {
                await this.quit();

                process.exit(0);
            });
        }
    }
}

module.exports = httpServer;