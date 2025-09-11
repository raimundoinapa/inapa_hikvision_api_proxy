//Desarrollado por Raimundo Araujo - +18493768181 / https://rcsoft.club.com
 
(async () => {
    const {app, q, select, create, runFetch, dbExists, dbStart, getISO8601Timestamp, enableForm, disableForm} = __CPLIB__;
    const defaultStreamProtocol = 'websocket';
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
    
    const maxFailedTokenCount = 3;
    const appLoadTimestamp = new Date().getTime();
    const dbMinTimeBetweenUpdates = 3 * 60 * 60 * 1000;//Tres horas
    const captureMinTimeBetweenUpdates = 1 * 60 * 60 * 1000;//Una hora
    const statusOptions = {
        '': 'Todos',
        1: 'Online',
        2: 'Offline'
    }
    const sortOptions = {
        '': 'Default',
        1: 'Nombre Asc',
        2: 'Nombre Desc',
        3: 'Area Asc',
        4: 'Area Desc',
        5: 'Device Desc',
        6: 'Device Desc'
    };
    const gridOptions = {4: 'grid-4x4', 3: 'grid-3x3', 2: 'grid-2x2', 1: 'grid-1x1'};
    const itemsPerPage = Object.keys(gridOptions).reduce((acc, key) => {
        acc[key] = key * key;

        return acc;
    }, {});
    const maxVisiblePaginationButtons = 5;
    const configOptions = app.get('configOptions') ? JSON.parse(app.get('configOptions')) : {
        username: '',
        usertoken: '',
        filterStatus: Object.keys(statusOptions).sort((a, b) => a === '' || b === '' ? -1 : a - b)[0],
        filterFavorites: [],
        filterCapabilities: [],
        filterDevices: [],
        filterAreas: [],
        searchKeywords: '',/*Listado de palabras separadas por (,), ej.: Lobby Santiago, Estacionamiento La Vega*/
        favorites: [],
        sortBy: Object.keys(sortOptions).sort((a, b) => a === '' || b === '' ? -1 : a - b)[0],
        gridSize: Object.keys(gridOptions).sort((a, b) => b - a)[0],
        currentPage: 1,
        lastDBUpdate: '',
        invalidTokenCount: 0
    };
    const cameraCount = {online: 0, offline: 0};
    const specialFilterStoreNames = ['filterFavorites', 'filterCapabilities', 'filterDevices', 'filterAreas'];
    const sortProps = ['cameraName', ['area', 'name'], ['encodeDeviceInfo', 'encodeDevName']];
    const dataObj = {
        local: [],
        remote: [],
        filtered: []
    };
    const filtersObj = {
        favorites: [['favorites', 'Favoritos']],
        capabilities: [],
        devices: [],
        areas: [],
    };
    const playersStatus = {};

    var jsDecoder = {};

    const dbName = app.get('dbName') || 'inapa_cctv';
    const dbVersion = app.get('dbVersion') || 1;
    const dbSchema = [
        {
            storeName: 'cameras',
            keyPath: 'key',
            index: [
                {name: 'cameraIndexCode', unique: true},
                {name: 'capabilitySet'},
                {name: 'encodeDevIndexCode'},/* {name: 'encodeDevIndexCode', index: 'encodeDeviceInfo.encodeDevIndexCode'}, */
                {name: 'regionIndexCode'},
                {name: 'status'}
            ]
        }
    ];
    const dbRequest = await (async () => {
        const isDB = await dbExists(dbName);
        const dbUpdate = ! isDB ? async (db) => {
            for (const store of dbSchema) {
                if (! db.objectStoreNames.contains(store.storeName)) {    
                    const objectStore = db.createObjectStore(store.storeName, {autoIncrement: true, keyPath: 'key'});
    
                    if (objectStore && store.index) {
                        for (const st of store.index) {
                            objectStore.createIndex(st.name, st.index || st.name, {unique: !!st.unique});
                        }
                    }
    
                    console.info(`ObjectStore "${store.storeName}" creado satisfactoriamente`);
                }
            }
    
            app.set('dbName', dbName);
            app.set('dbVersion', dbVersion);
        } : false;

        return await dbStart(dbName, dbVersion, dbUpdate);
    })();

    const jsPluginGridContainerId = 'jsPluginGridContainer';
    const jsPluginContainer = select(`#${jsPluginGridContainerId}`);
    const videoPlayerContainerIdIndex = 'jsPluginGridContainerplayer-container-';
    const videoPlayerIdIndex = 'jsPluginGridContainer_playWindow';
    const globalPreloader = q('.global-preloader');
    const onlineBadge = q('#online-badge');
    const offlineBadge = q('#offline-badge');
    const totalBadge = q('#total-badge');
    const toolsForm = q('#tools-form');
    const filtersDialog = q("#filters-dialog");
    const btnStartAll = q('#btn-start-all');
    const btnStopAll = q('#btn-stop-all');
    const btnFullscreenAll = q('#btn-fullscreen-all');
    const btnRefreshAll = q('#btn-refresh-all');
    const gridWrapper = q('#camera-grid-wrapper');
    const paginationContainer = q('#pagination');
    const gridPreloader = create('div', false, {className: 'preloader', style: {zIndex: 1001}});
    const scrollbarWidth = (() => {
        const div = create('div', false, {style: {position: 'absolute', visibility: 'hidden', overflow: 'scroll', width: '100px'}});

        document.body.appendChild(div);
      
        const w = div.offsetWidth - div.clientWidth;

        div._remove();

        return w;
    })();

    const saveConfig = () => { app.set('configOptions', JSON.stringify(configOptions)); }

    const showSnackbar = function(msg = '', severity = 'info', duration = '') {
        const sb = create('a-dialog', {
            snackbar: duration, 'snackbar-progress' : '', 'self-destroy': '', bottom: '', right: '', transition: 'swipe-up', state: 'active'
        }, {innerHTML: msg});

        const attr = {};
        attr[severity] = '';

        sb.setAttr = attr;
        
        document.body.appendChild(sb);
    }

    const login = async () => {
        const authToken = await runFetch(endpoints.auth, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({username: 'admin', password: 'admin123'})
        });

        //OJO: Esta línea simula un loguo exitoso
        //const authToken = { data: {username: 'admin', token: 'asdfadfasdfasd'}};
    
        if (! authToken?.data?.token) {
            showSnackbar('Error de autenticación', 'warning');

            console.error('Error de autenticación');
    
            return false;
        }
    
        configOptions.invalidTokenCount = 0;
        configOptions.username = authToken.data.username;
        configOptions.token = authToken.data.token;
        saveConfig();

        return true;
    }

    const isAllowed = (res) => {
        if (403 == res?.httpStatusCode) {
            configOptions.invalidTokenCount++;
            saveConfig();

            if (configOptions.invalidTokenCount < maxFailedTokenCount) { window.location.reload(); }

            const invalidCredentialsMsg = 'Credenciales de autenticación inválidas, póngase en contacto con el administrador';

            showSnackbar(invalidCredentialsMsg, 'warning');

            console.error(invalidCredentialsMsg);

            return false;
        }

        return true;
    }

    const filterData = async () => {
        dataObj.filtered = await dbRequest._getAll('cameras');

        dataObj.filtered.sort((a, b) => Number(a.cameraIndexCode) - Number(b.cameraIndexCode));
        
        const words = ! configOptions.searchKeywords.trim().length ? [] : configOptions.searchKeywords.split(',').map(m => m.trim().toLowerCase());

        if (configOptions?.filterStatus) {
            dataObj.filtered = dataObj.filtered.filter(f => configOptions.filterStatus == f.status);
        }

        //OJO: No implementado, hace falta poner hamburger que abra un drawer en el lado izquierdo con todas las areas y cámaras en forma de arbol
        //que puedan ser expandidos y/o contraidos y checkboxes para elegir, si elegimos un nodo principal, se eligen todos los hijos, si quitamos
        //la elección de uno de los hijos, el check del nodo cambia a un estado intermedio.
        //Un filtro o buscardor para reducir la lista para elegir sería un plus muy importante
        //En su defecto, de no implementar este feature, simplemente agregar un botón para agregar a favoritos a las cartas
            //Para el caso de Favorites, lo puse como parte de los filtros especiales solo que que visualmente funcionen como los demas filtros especiales.
            //Pero para fines de filtrado, es independiente, el cotejo servirá solo para saber si esta activo o nó
        if (configOptions.filterFavorites.length && configOptions.favorites.length) {
            dataObj.filtered = dataObj.filtered.filter(f => configOptions.favorites.includes(f.cameraIndexCode));
        }

        //Aqui nos aseguramos de que filterFavorites no sea parte de los filtros especiales
        if (specialFilterStoreNames.some((s) => 'filterFavorites' != s && configOptions?.[s]?.length)) {
            dataObj.filtered = dataObj.filtered.filter((f) => {
                return configOptions.filterCapabilities.includes(f.capabilitySet) || 
                    configOptions.filterDevices.includes(f.encodeDevIndexCode) || 
                    configOptions.filterAreas.includes(f.regionIndexCode);
            });
        }

        if (words.length) {
            dataObj.filtered = dataObj.filtered.filter((f) => {
                return (words.some(s => (f.capabilitySet.toLowerCase().indexOf(s) + 1) || 
                    (f.cameraName.toLowerCase().indexOf(s) + 1) ||
                    (f.area.name.toLowerCase().indexOf(s) + 1) || 
                    (f.encodeDeviceInfo.encodeDevName.indexOf(s) + 1)));
            });
        }

        if (configOptions.sortBy) {
            const isAsc = configOptions.sortBy % 2;
            const propIndex = Math.floor(configOptions.sortBy / 2) - (! isAsc ? 1 : 0);
            const prop = sortProps[propIndex];

            dataObj.filtered.sort((a, b) => {
                if ('string' == typeof prop) {
                    if (isAsc) {
                        return a[prop].localeCompare(b[prop]);
                    } else {
                        return b[prop].localeCompare(a[prop]);
                    }
                } else {
                    if (isAsc) {
                        return a[prop[0]][prop[1]].localeCompare(b[prop[0]][prop[1]]);
                    } else {
                        return b[prop[0]][prop[1]].localeCompare(a[prop[0]][prop[1]]);
                    }
                }
            });
        }
    }

    const isFilterActive = () => specialFilterStoreNames.some(s => configOptions?.[s]?.length);

    const disablePagination = () => {
        const btns = q('#pagination a-button', true) || [];
        const pageJump = q('#pagination select');
        
        if (btns?.length) {
            btns.forEach(e => e.setAttr = {disabled: true});
        }

        if (pageJump) { pageJump.disabled = true; }
    }

    const enablePagination = () => {
        const btns = q('#pagination a-button', true) || [];
        const pageJump = q('#pagination select');
        const lastPage = pageJump?.options?.length;

        if (btns?.length) {
            const btnPrev = btns[0];
            const btnNext = btns[btns.length - 1];

            btns.forEach((e) => {
                const curentPage = e.dataset.currentPage;

                if (curentPage) {
                    if (1 == curentPage) {
                        btnPrev.setAttr = {disabled: true}
                    }
                    
                    if (lastPage && lastPage == curentPage) {
                        btnNext.setAttr = {disabled: true}
                    }
                } else {
                    e.remAttr = 'disabled';
                }
            });
        }

        if (pageJump) { pageJump.disabled = false; }
    }
    
    const stopAllPlayers = async () => {
        //No usamos este bloque porque necesitamos relizar mas operaciones en la UI
        /*if (jsDecoder?.JS_StopRealPlayAll) { jsDecoder.JS_StopRealPlayAll(); }

        return false;*/

        const playerEntries = Object.values(playersStatus);

        if (! playerEntries?.length) { return false; }

        const playersPromises = [];

        for (let i = 0; i < playerEntries.length; i++) {
            const entry = playerEntries[i];

            if (entry?.isPlaying && entry?.playStopFnc) {
                playersPromises.push(entry.playStopFnc());
            }
        }

        if (! playersPromises.length) { return false; }

        await Promise.all(playersPromises);

        return true;
    }

    const createGrid = async () => {
        jsPluginContainer.innerHTML = '';
        
        jsDecoder = await new JSPlugin({
            szId: jsPluginGridContainerId,
            /* iWidth: '100%',
            iHeight: '100%', */
            iMaxSplit: parseInt(configOptions.gridSize),
            iCurrentSplit: parseInt(configOptions.gridSize),
            szBasePath: "/jsplugin",
            /* oStyle: {
                border: "#343434",
                borderSelect: "red",
                background: "#4C4B4B"
            } */
        });

        const gridContainer = jsPluginContainer.firstElementChild;
        const gridElems = jsPluginContainer._select('*', true);

        gridContainer.id = 'camera-grid';
        gridContainer._addClass(gridOptions[configOptions.gridSize]);

        //Quitamos los estilos y tamaños que JSPlugin asigna
        gridElems.forEach((e) => {
            e.removeAttribute('style');
            e.removeAttribute('width');
            e.removeAttribute('height');
        });

        if (! dataObj.filtered.length) {
            showSnackbar('<h2 class="t-center">No se contraron resultados</h2>', 'warning');

            return false;
        }

        gridWrapper.appendChild(gridPreloader);
        
        //Limpiamos todo
        Object.keys(playersStatus).forEach(p => delete playersStatus[p]);

        //Si el grid es 4x4
        //0-15, 16-31, 32-47
        const range = {
            from: (configOptions.currentPage - 1) * itemsPerPage[configOptions.gridSize],
            to: (configOptions.currentPage * itemsPerPage[configOptions.gridSize]) - 1,
        }

        let iterationNum = 0;

        for (let i = range.from; i <= range.to; i++) {
            const camIndex = iterationNum;
            const camera = dataObj.filtered[i];
            const videoPlayerContainer = q(`#${videoPlayerContainerIdIndex}${camIndex}`);
            const videoPlayer = q(`#${videoPlayerIdIndex}${camIndex}`);
            const jqObj = Object.keys(videoPlayerContainer)?.[0];

            //Le quitamos los eventos para fullscreen y otros eventos agregados por JSPlugin al elemento video
            if (jqObj) {
                //delete videoPlayerContainer[jqObj].events.dblclick[0].handler;;
                //delete videoPlayerContainer[jqObj].events.dblclick;
                delete videoPlayerContainer[jqObj];
            }

            //Agregamos nuestra propia versión de fullscreen
            videoPlayerContainer._on('dblclick', (evt) => {
                const exitFS = ['exitFullscreen', 'webkitExitFullscreen', 'mozExitFullscreen', 'msExitFullscreen'];
                const elcFS = ['requestFullscreen', 'webkitRequestFullscreen', 'mozRequestFullscreen', 'msRequestFullscreen'];
                const docFSE = ['fullscreenElement', 'webkitFullscreenElement', 'mozFullScreenElement', 'msFullscreenElement'];
                const fsExitFnc = exitFS.filter(f => document?.[f])?.[0];
                const fsFnc = elcFS.filter(f => videoPlayerContainer?.[f])?.[0];
                const isFullscreen = docFSE.some(f => document?.[f]);

                if (! isFullscreen) {
                    if (fsFnc) { videoPlayerContainer[fsFnc](); }
                } else {
                    if (fsExitFnc) { document[fsExitFnc](); }
                }
            });

            if (! camera) {
                iterationNum++;

                continue;
            }

            const cameraFullName = [camera.cameraName, camera?.area?.name, camera?.encodingDeviceInfo?.encodeDevName].filter(f => f).join(' - ');
            const isOnline = camera?.status && camera.status.toString() == '1';
            const isPTZ = camera?.capabilitySet && camera.capabilitySet.toLowerCase().includes('ptz');
            const favoriteHighLight = ! configOptions.favorites.includes(camera.cameraIndexCode) ? '': ' info';
            const preloader = create('div', false, {className: 'preloader', style: {zIndex: 1001}});
            const nameBadge = `<span class="small">${cameraFullName}</span>`;
            const onlineBadge = '<a-badge danger pulse>Online</a-badge>';
            const offlineBadge = '<a-badge danger pulse>Offline</a-badge>';
            const statusBadge = ! isOnline ? offlineBadge : '';
            const videoPlayerContainerElements = videoPlayerContainer._select('*', true);

            videoPlayerContainerElements.forEach((e) => { e._remove(); });

            videoPlayerContainer.innerHTML = `
                <div class="refresh-btn-container">
                    <a-button icon circle id="refresh-${camera.cameraIndexCode}" aria-label="Recargar Cámera" disabled class="${! isOnline ? '' : 'd-none'}"><an-icon refresh></an-icon></a-button>
                </div>
                <div class="video-controls">
                    <div class="buttons">
                        <a-button icon circle id="play-stop-${camera.cameraIndexCode}" aria-label="Play" disabled><span style="font-size: 1rem; margin:0 0 3px 2px">▶</span></a-button>
                        <a-button icon circle id="capure-${camera.cameraIndexCode}" aria-label="Tomar Foto" disabled><an-icon camera></an-icon></a-button>
                        <a-button icon circle id="ptz-${camera.cameraIndexCode}" aria-label="Comandos PTZ" disabled class="${! isPTZ ? 'd-none' : ''}">
                            <style>
                                .controller {
                                    width: 15px;
                                    height: 14px;
                                    background-image: url('./img/controller.png');
                                }
                            </style>
                            <div class="controller"></div>
                        </a-button>
                        <a-button id="stream-switch-${camera.cameraIndexCode}" aria-label="Cambiar Stream" disabled>
                            <style>
                                :host(:not([icon])) .body {
                                    padding: 0.1rem 0.3rem 0 0.3rem;
                                }
                            </style>
                            <span style="font-size: 0.85rem;">hi-res</span>
                        </a-button>
                        <a-button icon circle id="favorite-${camera.cameraIndexCode}" aria-label="Agregar a favoritos"${favoriteHighLight} disabled><an-icon star></an-icon></a-button>
                    </div>
                </div>
                <div id="camera-status-msg-${camera.cameraIndexCode}" class="camera-status-container">
                    <div class="camera-status">${statusBadge}</div>
                </div>
                <div class="camera-name-container">
                    <div class="camera-name protected-from-dark">${nameBadge}</div>
                </div>
                <div id="stream-error-msg-${camera.cameraIndexCode}" class="stream-error-msg-container d-none">
                    <div class="stream-error protected-from-dark"><a-button icon circle warning><an-icon x size="1rem"></an-icon></a-button> Error del servidor de streaming</div>
                </div>
            `;
            videoPlayerContainer.style.backgroundImage = ! camera?.capture?.length ? `url(./img/camera-bg-placeholder.jpg)` : `url(${camera.capture})`;

            videoPlayerContainerElements.forEach((e) => { videoPlayerContainer.appendChild(e); });
            
            playersStatus[camera.cameraIndexCode] = {
                isOnline,
                isPlaying: false,
                isMainStream: false,
                captureRetry: false,
                streamError: false,
                playStopFnc: false
            }

            const vpStatus = playersStatus[camera.cameraIndexCode];
            const btnRefresh = q(`#refresh-${camera.cameraIndexCode}`);
            const btnPlay = q(`#play-stop-${camera.cameraIndexCode}`);
            const btnCapure = q(`#capure-${camera.cameraIndexCode}`);
            const btnPtz = q(`#ptz-${camera.cameraIndexCode}`);
            const btnStreamSwitch = q(`#stream-switch-${camera.cameraIndexCode}`);
            const btnFavorite = q(`#favorite-${camera.cameraIndexCode}`);
            const cameraStatusMsg = q(`#camera-status-msg-${camera.cameraIndexCode}`);
            const streamErrorMsg = q(`#stream-error-msg-${camera.cameraIndexCode}`);
            
            const imBusy = () => {
                videoPlayerContainer.appendChild(preloader);

                [btnRefresh, btnPlay, btnCapure, btnPtz, btnStreamSwitch, btnFavorite].forEach(b => b.setAttr = 'disabled');
            };
    
            const imNotBusy = () => {
                if (! vpStatus.isOnline) {
                    btnRefresh.remAttr = 'disabled';
                } else {
                    if (! vpStatus.isPlaying) {
                        btnPlay.remAttr = 'info';

                        if (btnPlay?.$el?.body) {
                            btnPlay.$el.body.innerHTML = '<span style="font-size: 1rem; margin:0 0 3px 2px">▶</span>';
                        }

                        btnStreamSwitch.remAttr = 'info';
                    } else {
                        btnPlay.setAttr = {info: true};

                        if (btnPlay?.$el?.body) {
                            btnPlay.$el.body.innerHTML = '<span style="font-size: 1rem">⏹</span>';
                        }

                        btnCapure.remAttr = 'disabled';

                        if (isPTZ) { btnPtz.remAttr = 'disabled'; }

                        if (! vpStatus.isMainStream) {
                            btnStreamSwitch.remAttr = 'info';
                        } else {
                            btnStreamSwitch.setAttr = {info: true};
                        }

                        btnStreamSwitch.remAttr = 'disabled';
                    }

                    btnPlay.remAttr = 'disabled';
                }

                btnFavorite.remAttr = 'disabled';

                streamErrorMsg.className = 'stream-error-msg-container' + (! vpStatus.streamError ? ' d-none' : '');
    
                preloader._remove();
            };

            const takePicture = async (download = false) => {                
                if (! vpStatus.isOnline) { return false; }

                imBusy();

                const timeStamp = new Date().getTime();

                let capturedPicture = '';
    
                if (! vpStatus.isPlaying) {
                    if (! camera?.captureTimestamp || (timeStamp - camera.captureTimestamp) > captureMinTimeBetweenUpdates) {
                        const capture = await runFetch(endpoints.protected.capture, {
                            method: 'POST',
                            headers: {
                                authorization: `Bearer ${configOptions.token}`
                            },
                            body: JSON.stringify({id: camera.cameraIndexCode}),
                            timeout: 10000
                        });

                        if (! isAllowed(capture) || ! capture?.data || capture?.data?.code) {
                            vpStatus.streamError = true;

                            //showSnackbar(`Error al tomar foto remota en la cámara ${camera.cameraIndexCode}`, 'warning');
                        } else {
                            vpStatus.streamError = false;

                            capturedPicture = capture.data;

                            if ("image/jpeg" == capture?.headers?.['content-type']) {
                                capturedPicture = URL.createObjectURL(capture.data);
                            }
                        }
                    }
                } else {
                    const canvas = create('canvas');
                    const context = canvas.getContext('2d');
    
                    canvas.width = videoPlayer.videoWidth;
                    canvas.height = videoPlayer.videoHeight;
                    context.drawImage(videoPlayer, 0, 0, canvas.width, canvas.height);
                    
                    capturedPicture = canvas.toDataURL('image/png');

                    if (download) {
                        const link = create('a', {href: capturedPicture, download: `${camera.cameraIndexCode}_capture_${timeStamp}.png`});
    
                        link.click();
                    }
                }

                if  (capturedPicture) {                    
                    camera.capture = capturedPicture;
                    camera.captureTimestamp = timeStamp;
                    dbRequest._put('cameras', camera);

                    videoPlayerContainer.style.backgroundImage = `url(${capturedPicture})`;
                }
    
                imNotBusy();

                return true;
            };

            const playStopStream = async (isMainStream = false) => {
                if (! vpStatus.isOnline) { return false; }

                imBusy();

                const stremUrl = ! isMainStream ? camera.subStream : camera.mainStream;
    
                if (! vpStatus.isPlaying) {
                    await new Promise((resolve) => {
                        jsDecoder.JS_Play(stremUrl, {
                            playURL: stremUrl,
                            auth: '',
                            token: '',
                            mode: 'media',
                        }, camIndex).then(async () => {
                            vpStatus.isPlaying = true;
                            vpStatus.isMainStream = isMainStream;
                            vpStatus.streamError = false;

                            console.log(`Transmisión de la cámara ${camIndex} (${camera.cameraIndexCode}) iniciada satisfactoriamente`);

                            return resolve(true);
                        }, () => {
                            vpStatus.streamError = true;
                            
                            showSnackbar(`No se pudo inicar la transmisión de la cámara ${camIndex} (${camera.cameraIndexCode})`, 'warning');

                            return resolve(false);
                        });
                    });
                } else {
                    imNotBusy();

                    await takePicture();

                    imBusy();

                    await new Promise((resolve) => {
                        jsDecoder.JS_Stop(camIndex).then(() => {
                            console.log(`Transmisión de cámara ${camIndex} (${camera.cameraIndexCode}) detenida satisfactoriamente`);

                            vpStatus.isPlaying = false;
                            vpStatus.isMainStream = false;

                            return resolve(true);
                        }, () => {
                            showSnackbar(`Error al detener la transmisión de la cámara ${camIndex} (${camera.cameraIndexCode})`, 'warning');

                            return resolve(false);
                        });
                    });
                }

                imNotBusy();

                return true;
            }

            btnPlay._on('click', async (evt) => {
                evt.preventDefault();
                
                playStopStream();
            });
    
            btnCapure._on('click', async (evt) => {;
                evt.preventDefault();

                takePicture(true);
            });

            btnStreamSwitch._on('click', async (evt) => {
                evt.preventDefault();
    
                if (vpStatus.isPlaying) {
                    const hires = ! vpStatus.isMainStream;
                    
                    await playStopStream();//Detenemos el stream actual

                    playStopStream(hires);//Iniciamos el stream de nuevo
                }
            });

            btnFavorite._on('click', async (evt) => {
                evt.preventDefault();

                if (! configOptions.favorites.includes(camera.cameraIndexCode)) {
                    configOptions.favorites.push(camera.cameraIndexCode);

                    btnFavorite.setAttr = { info: true };
                } else {
                    configOptions.favorites.splice(configOptions.favorites.indexOf(camera.cameraIndexCode), 1); 

                    btnFavorite.remAttr = 'info';
                }

                saveConfig();
            });

            //OJO: Implementar el refrescado de 1 player, esto incluye pedir los datos al servidor actualizar los datos locales y actualizar el player, y en caso de que la entrada no exista dejar un placeholder para no reorganizar
            //la vista sino hasta la siguiente interación con cualquiera de los filtros o el paginador (el paginador cambiaría en tal caso, lo que crearía un error lógico no grave con la relación al númeor de página actual)
            btnRefresh._on('click', async (evt) => {
                evt.preventDefault();

                imBusy();

                const cameraCheck = await runFetch(endpoints.protected.integralSingle, {
                    method: 'POST',
                    headers: {
                        authorization: `Bearer ${configOptions.token}`
                    },
                    body: JSON.stringify({id: camera.cameraIndexCode, protocol: defaultStreamProtocol}),
                    timeout: 10000
                });

                if (isAllowed(capture) && cameraCheck?.data?.length & 1 == cameraCheck?.data?.status) {
                    vpStatus.isOnline = true;

                    if (camera?.captureTimestamp && camera?.capture) {
                        cameraCheck.captureTimestamp = camera.captureTimestamp;
                        cameraCheck.capture = camera.capture;
                    }

                    dbRequest._put('cameras', cameraCheck);
                }

                imNotBusy();
            });
            
            imNotBusy();//Activamos los botones necesarios
            
            if (vpStatus.isOnline) {
                vpStatus.playStopFnc = playStopStream;

                if (! camera?.captureTimestamp) {
                    (async () => {
                        console.log(`Tomando foto remota a la cámara ${camIndex} (${camera.cameraIndexCode})`);
    
                        await takePicture();
    
                        if (! camera?.captureTimestamp && ! vpStatus.captureRetry) {
                            takePicture();
    
                            vpStatus.captureRetry = true;

                            console.log(`Intentaremos tomar la foto remota de nuevo a la cámara ${camIndex} (${camera.cameraIndexCode})`);
                        }
                    })();
                }
            }

            iterationNum++;
        }

        gridPreloader._remove();

        return true;
    }

    const createPagination = (isTriggeredByButton = false) => {
        if (! dataObj.filtered.length) {
            paginationContainer.innerHTML = '';

            return false;
        }

        const totalPages = Math.ceil(dataObj.filtered.length / itemsPerPage[configOptions.gridSize]);
        const isMultipleRenders = totalPages > maxVisiblePaginationButtons;
        const maxPreviousOrNextNumbers = Math.floor(maxVisiblePaginationButtons / 2);
        const range = {
            from: 1,
            to: totalPages < maxVisiblePaginationButtons ? totalPages : maxVisiblePaginationButtons
        };
        const paginationForm = create('form', {is: 'super-form'}, {className: 'd-flex-center gap0-5 mb1'});
        const prevButton = create('a-button', {info: true}, {'aria-label': 'Anterior', innerHTML: 'Anterior'});
        const nextButton = create('a-button', {info: true}, {'aria-label': 'Siguiente', innerHTML: 'Siguiente'});

        if (isMultipleRenders) {
            if ((configOptions.currentPage + maxPreviousOrNextNumbers) >= maxVisiblePaginationButtons) {
                range.from = configOptions.currentPage - maxPreviousOrNextNumbers;
                range.to = configOptions.currentPage + maxPreviousOrNextNumbers;
            }
            if (range.to > totalPages) {
                range.from = totalPages - maxVisiblePaginationButtons + 1;
                range.to = totalPages;
            }
        }

        if (1 == configOptions.currentPage) {
            prevButton.setAttr = {disabled: true};
        } else {
            prevButton._on('click', (evt) => {
                evt.preventDefault();

                configOptions.currentPage--;
                saveConfig();
                
                reCreateGrid(true);

                return false;
            });
        }

        if (totalPages == configOptions.currentPage) {
            nextButton.setAttr = {disabled: true};
        } else {
            nextButton._on('click', (evt) => {
                evt.preventDefault();

                configOptions.currentPage++;
                saveConfig();
                
                reCreateGrid();

                return false;
            });
        }

        paginationForm.appendChild(prevButton);
        
        for (let i = range.from; i <= range.to; i++) {
            const btn = create('a-button', {info: true}, {'aria-label': i, innerHTML: i.toString()});

            if (i == configOptions.currentPage) {
                btn.remAttr = 'info';
                btn.setAttr = {success: true};
                btn.setAttr = {disabled: true};
                btn.dataset.currentPage = i;
            } else {
                btn._on('click', (evt) => {
                    evt.preventDefault();

                    configOptions.currentPage = i;
                    saveConfig();

                    reCreateGrid();
    
                    return false;
                });
            }

            paginationForm.appendChild(btn);
        }

        paginationForm.appendChild(nextButton);

        const selectBox = create('select', {name: 'page-jump'}, {style: {width: 'auto'}});

        for (let i = 1; i <= totalPages; i++) {
            const opt = create('option', {value: i}, {innerHTML: `Página ${i}`});

            if (i == configOptions.currentPage) { opt.selected = true; } 

            selectBox.appendChild(opt);
        }

        selectBox._on('change', (evt) => {
            evt.preventDefault();

            configOptions.currentPage = Number(evt.target.value);
            saveConfig();

            reCreateGrid();

            return false;
        });

        paginationForm.appendChild(selectBox);
        paginationContainer.innerHTML = '';
        paginationContainer.appendChild(paginationForm);
    }

    const reCreateGrid = async (isTriggeredByButton = false) => {
        disablePagination();
        disableForm(toolsForm);
        disableForm(filtersDialog.$el['filters-form']);

        await stopAllPlayers();
        
        await filterData();

        await createGrid();

        createPagination(isTriggeredByButton);
        enableForm(toolsForm);
        enableForm(filtersDialog.$el['filters-form']);
    }

    if (! configOptions.token) {
        if (! await login()) { return false; }

        const version = await runFetch(endpoints.protected.version, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${configOptions.token}`
            }
        });
        
        console.log(version);
    }

    const authCheck = await runFetch(endpoints.protected.authCheck, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${configOptions.token}`
        }
    });

    if (! isAllowed(authCheck) || 'success' != authCheck?.status) {   
        if (! await login()) { return false; }
    }

    dataObj.local = await dbRequest._getAll('cameras');

    if (! configOptions.lastDBUpdate || (appLoadTimestamp - configOptions.lastDBUpdate) > dbMinTimeBetweenUpdates) {
        if (! configOptions.lastDBUpdate) {
            showSnackbar(`<h2>Instalando</h2><p>Actualizando base de datos...</p>`, 'info');
        } else {
            showSnackbar(`<h2>Actualizando</h2><p>Base de datos actuazada por última vez el ${getISO8601Timestamp(configOptions.lastDBUpdate)}. <br>Ejecutaremos una nueva actualización</p>`, 'info');
        }

        dataObj.remote = await runFetch(endpoints.protected.integral, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${configOptions.token}`
            },
            body: JSON.stringify({protocol: defaultStreamProtocol}),
            timeout: 60000
        });

        dataObj.remote = dataObj.remote?.data?.list || [];

        //OJO: Estas dos líneas so para simular la respuesta del server
        //dataObj.remote = await runFetch('./db.json');
        //dataObj.remote = dataObj.remote?.data?.list || [];

        if (dataObj.remote?.length) {
            const localDbUpdates = [];
            
            if (dataObj.local?.length) {
                const localDbCaptures = [];
    
                dataObj.remote.forEach((f) => {
                    localDbCaptures.push(dbRequest._get('cameras', {index: 'cameraIndexCode', value: f.cameraIndexCode}));
                });
    
                if (localDbCaptures?.length) {
                    await Promise.all(localDbCaptures);
        
                    localDbCaptures.forEach((c, i) => {
                        if (c.capture && c.captureTimestamp) {
                            dataObj.remote[i].capture = c.capture;
                            dataObj.remote[i].captureTimestamp = c.captureTimestamp;
                        }
                    });
                }
    
                await dbRequest._clear('cameras');    
            }
    
            dataObj.remote.forEach((c, i) => {
                if (! c.capabilitySet) { c.capabilitySet = 'unknow'; }
                if (! c.encodeDevIndexCode || ! c?.encodeDeviceInfo?.encodeDevIndexCode) {
                    c.encodeDevIndexCode = 'unknow';
                    c.encodeDeviceInfo = {
                        encodeDevIndexCode: 'unknow',
                        encodeDevName: 'Unknow',
                    }
                }
                if (! c.regionIndexCode || ! c?.area?.indexCode) {
                    c.regionIndexCode = 'unknow';
                    c.area = {
                        indexCode: 'unknow',
                        name: 'Unknow',
                    }
                }

                localDbUpdates.push(dbRequest._put('cameras', c, true));
            });

            if (localDbUpdates.length) {
                await Promise.all(localDbUpdates);

                configOptions.lastDBUpdate = new Date().getTime();
                saveConfig();

                console.log('Base de datos actualizada');
            }
        }

        dataObj.local = dataObj.remote;
    }

    dataObj.local.forEach((f) => {
        filtersObj.capabilities.push([f.capabilitySet, f.capabilitySet]);
        filtersObj.devices.push([f.encodeDevIndexCode, f.encodeDeviceInfo.encodeDevName]);
        filtersObj.areas.push([f.regionIndexCode, f.area.name]);

        if (1 == f.status) { cameraCount.online++; } else { cameraCount.offline++; }
    });

    onlineBadge.$el.body.innerHTML = `${cameraCount.online} Online`;
    offlineBadge.$el.body.innerHTML = `${cameraCount.offline} Offline`;
    totalBadge.$el.body.innerHTML = `${cameraCount.online + cameraCount.offline} Total`;

    toolsForm.elements['search'].value = configOptions.searchKeywords;
    
    Object.keys(statusOptions).sort((a, b) => a === '' || b === '' ? -1 : a - b).forEach((k) => {
        toolsForm.elements['status-select'].appendChild(create('option', {value: k}, {innerHTML: statusOptions[k]}));
    });
    toolsForm.elements['status-select'].value = configOptions.filterStatus;

    Object.keys(filtersObj).forEach((k, i) => {
        const fInputContainer = filtersDialog.$el[`${k}-container`];
        const fcBody = filtersDialog.$el[`${k}-selected-count`].$el.body;
        const filterCount = {
            total: 0,
            selected: 0
        };

        fInputContainer.innerHTML = '';

        if (filtersObj[k].length) {
            filtersObj[k] = [...new Set(filtersObj[k].map(JSON.stringify))].map(JSON.parse);//Quitamos los duplicados del array de arrays
            filtersObj[k].sort((a, b) => a[1].localeCompare(b[1]));//Sorteamos por nombre;
    
            filtersObj[k].forEach((c) => {
                const checked = configOptions?.[specialFilterStoreNames[i]]?.length && configOptions[specialFilterStoreNames[i]].includes(c[0]) ? ' checked' : '';
                const inp = create('div', false, {innerHTML: `<label><input type="checkbox" name="${k}-${c[0]}" value="${c[0]}"${checked}> ${c[1]}</label>`});

                inp._on('change', (evt) => {
                    if (! evt.target.checked) {
                        fcBody.innerHTML = Number(fcBody.innerHTML.trim()) - 1;

                        return false;
                    }

                    fcBody.innerHTML = Number(fcBody.innerHTML.trim()) + 1;
                });
        
                fInputContainer.appendChild(inp);
                
                filterCount.total++;
                if (checked) { filterCount.selected++; }
            });

            filtersDialog.$el[`${k}-count`].$el.body.innerHTML = filterCount.total;
            fcBody.innerHTML = filterCount.selected;
        }
    });

    //Fix para menú de filtros ya que tiene un super-form, y de iniciarse en la posición que queremos, estaría dentro de otro super-form lo que causa problemas al activarse el super-form inicial
    q('[aria-controls="filters-dialog"]').parentNode.appendChild(filtersDialog);    

    filtersDialog.$el.toggler.dataset.filterSet = ! isFilterActive() ? "false" : "true";

    Object.keys(sortOptions).sort((a, b) => a === '' || b === '' ? -1 : a - b).forEach((k) => {
        toolsForm.elements['sort-select'].appendChild(create('option', {value: k}, {innerHTML: sortOptions[k]}));
    });
    toolsForm.elements['sort-select'].value = configOptions.sortBy;

    Object.keys(gridOptions).sort((a, b) => b - a).forEach((k) => {
        toolsForm.elements['grid-size-select'].appendChild(create('option', {value: k}, {innerHTML: gridOptions[k].replace('grid-', '')}));
    });
    toolsForm.elements['grid-size-select'].value = configOptions.gridSize;

    //Fix para fullscreen en pantallas diferentes a mi laptop tomando en cuenta el tamaño aproximado del scrollbar
    document.body.appendChild(create('style', false, {innerHTML: `
        :root { --max-width: ${Math.round(screen.width / 1.347368421052632)}px; }
        #camera-grid:-webkit-full-screen { --max-width: ${screen.width - scrollbarWidth}px; }
        #camera-grid:-moz-full-screen { --max-width: ${screen.width - scrollbarWidth}px; }
        #camera-grid:-ms-full-screen { --max-width: ${screen.width - scrollbarWidth}px; }
    `}));

    //Esta viene siendo la acción del search
    toolsForm._onsubmit = async (evt, frm, frmData) => {
        configOptions.searchKeywords = frm.elements['search'].value;
        configOptions.currentPage = 1;
        saveConfig(); 
        
        await reCreateGrid();

        frm.elements['search-button'].$el.loadingBox._remove();
    };

    toolsForm.elements['search']._on('input', (evt) => {
        if (! evt.target.value) {
            configOptions.searchKeywords = '';
            configOptions.currentPage = 1;
            saveConfig();
            
            reCreateGrid();
        }
    });

    toolsForm.elements['status-select']._on('change', (evt) => {
        configOptions.filterStatus = evt.target.value;
        configOptions.currentPage = 1;
        saveConfig();
        
        reCreateGrid();
    });

    toolsForm.elements['sort-select']._on('change', (evt) => {
        configOptions.sortBy = evt.target.value;
        configOptions.currentPage = 1;
        saveConfig();
        
        reCreateGrid();
    });

    toolsForm.elements['grid-size-select']._on('change', async (evt) => {
        const gridValue = evt.target.value;

        configOptions.gridSize = gridValue;
        configOptions.currentPage = 1;
        saveConfig();

        await reCreateGrid();
    });
    
    filtersDialog.$el['filters-form']._onsubmit = (evt, frm, frmData) => {
        specialFilterStoreNames.forEach((s) => { configOptions[s] = []; });

        const filterKeyNames = Object.keys(filtersObj);
        const filtersCount = filterKeyNames.reduce((acc, key) => {
            acc[key] = {total: 0, selected: 0};
    
            return acc;
        }, {});

        for (const e of frm.elements) {
            if (e?.name) {
                filterKeyNames.forEach((k, i) => {
                    if (e.name.includes(k)) {
                        filtersCount[k].total++;

                        if (e?.checked) {
                            configOptions[specialFilterStoreNames[i]].push(e.value);

                            filtersCount[k].selected++;
                        }
                    }
                });
            }
        }

        filterKeyNames.forEach((k, i) => {
            filtersDialog.$el[`${k}-count`].$el.body.innerHTML = filtersCount[k].total;
            filtersDialog.$el[`${k}-selected-count`].$el.body.innerHTML = filtersCount[k].selected;
        });

        configOptions.currentPage = 1;
        saveConfig();

        filtersDialog.$el.toggler.click();
        
        enableForm(frm);
        
        frm.elements['save'].$el.loadingBox._remove();

        reCreateGrid();
    };

    filtersDialog.$el['filters-form'].elements['reset']._on('click', (evt) => {
        evt.preventDefault();

        for (const e of filtersDialog.$el['filters-form'].elements) {
            if (e?.checked && e?.name) {
                e.checked = false;
            }
        }
    });

    filtersDialog._onClose = (evt, frm, frmData) => {
        filtersDialog.$el.toggler.dataset.filterSet = ! isFilterActive() ? "false" : "true";

        const filterKeyNames = Object.keys(filtersObj);

        for (const e of filtersDialog.$el['filters-form'].elements) {
            if (e?.name && e?.value) {
                filterKeyNames.forEach((k, i) => {
                    if (e.name.includes(k)) {
                        e.checked = configOptions[specialFilterStoreNames[i]].includes(e.value);
                    }
                });
            }
        }
    };

    btnStartAll._on('click', async (evt) => {
        const playerEntries = Object.values(playersStatus);

        if (! playerEntries?.length) { return false; }
        
        disableForm(toolsForm);
        disableForm(filtersDialog.$el['filters-form']);
        disablePagination();
        
        //Estrategia para iniciar una fila a la vez. En este caso Object.values aparentemente devuelve los valores sin un orden específico o tal vez por el key nummérico real, lo que hace que
        //se inicieel total de players equivalente a una file pero visualmente se ve random
        let playersPromises = [];

        for (let i = 0; i < playerEntries.length; i++) {
            const entry = playerEntries[i];

            //Si hay promesas por cumplir y estas suman una fila del grid o es la última fila del grid, esperamos las promesas
            if (playersPromises.length && (! (i % configOptions.gridSize) || i == playerEntries.length - 1)) {
                //Vamos a comentar esta línea para comparar entre el inicio de todos los streams y el inicio de todos los streams con la nueva estrategia
                //await Promise.all(playersPromises);

                playersPromises = [];
            }

            if (! entry?.isPlaying && entry?.playStopFnc) {
                playersPromises.push(entry.playStopFnc());
            }
        }

        enableForm(toolsForm);
        enableForm(filtersDialog.$el['filters-form']);
        enablePagination();
    });

    btnStopAll._on('click', (evt) => { stopAllPlayers(); });

    btnFullscreenAll._on('click', (evt) => {
        const gridContainer = q('#camera-grid') || {};
        const elcFS = ['requestFullscreen', 'webkitRequestFullscreen', 'mozRequestFullscreen', 'msRequestFullscreen'];
        const docFSE = ['fullscreenElement', 'webkitFullscreenElement', 'mozFullScreenElement', 'msFullscreenElement'];
        const fsFnc = elcFS.filter(f => gridContainer?.[f])?.[0];
        const isFullscreen = docFSE.some(f => document?.[f]);

        if (! isFullscreen && fsFnc) { gridContainer[fsFnc](); }
    });

    btnRefreshAll._on('click', (evt) => {
        window.location.reload();
    });

    await reCreateGrid();


    if (! dataObj.filtered.length) {
        showSnackbar('No se encontraron resultados', 'warning');
    }

    globalPreloader.remove();
})();