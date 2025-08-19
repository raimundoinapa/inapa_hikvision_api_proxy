(async () => {
    const {app, q, create, runFetch, dbExists, dbStart, getISO8601Timestamp, enableForm, disableForm} = __CPLIB__;
    const apiServerProtocol = 'http';
    const apiDomain = '172.20.2.99';
    const port = '3000';
    const apiServerUrl = `${apiServerProtocol}://${apiDomain}${! port ? '' : ':' + port}`;
    const endpoints = {
        auth: '/auth/login',
        health: '/health',
        generatehash: '/generatehash',
        protected: {
            authCheck: '/auth/check',
            version: '/api/version',
            encodeDeviceList: '/api/encoding-devices',
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
            integral: '/api/cameras/integral',
            integralSingle: '/api/cameras/integral-single'
        }
    };
    
    const appLoadTimestamp = new Date().getTime();
    const dbMinTimeBetweenUpdates = 1 * 60 * 60 * 1000;
    const captureMinTimeBetweenUpdates = 15 * 60 * 1000;
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
        filterCameras: [],/*15, 22, 65*/
        filterStatus: Object.keys(statusOptions).sort((a, b) => a === '' || b === '' ? -1 : a - b)[0],
        filterCapabilities: [],/*ptz, thermal, anpr*/
        filterDevices: [],/*14, 7, 44*/
        filterAreas: [],/*52, 57, 22*/
        searchKeywords: '',/*Lobby Santiago, Estacionamiento La Vega*/
        sortBy: Object.keys(sortOptions).sort((a, b) => a === '' || b === '' ? -1 : a - b)[0],
        gridSize: Object.keys(gridOptions).sort((a, b) => b - a)[0],
        currentPage: 1,
        lastDBUpdate: '',
    };
    const cameraCount = {online: 0, offline: 0};
    const specialFilterStoreNames = ['filterCapabilities', 'filterDevices', 'filterAreas'];
    const filterProps = ['cameraName', ['area', 'name'], ['encodeDeviceInfo', 'encodeDevName']];
    const dataObj = {
        local: [],
        remote: [],
        filtered: []
    };
    const filtersObj = {
        capabilities: [],
        devices: [],
        areas: [],
    };
    const playersObj = {
        play: [],
        capture: []
    }

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
    const gridContainerWrapper = q('#camera-grid-wrapper');
    const gridContainer = q('#camera-grid');
    const gridPreloader = create('div', false, {className: 'preloader', style: {zIndex: 1001}});
    const paginationContainer = q('#pagination');

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
        const authToken = await runFetch(apiServerUrl + endpoints.auth, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({username: 'admin', password: 'admin123'})
        });

        //OJO: Esta línea simula un loguo exitoso
        //const authToken = { data: {username: 'admin', token: 'asdfadfasdfasd'}};
    
        if (! authToken?.data?.token) {
            console.error('Error de autenticación');
    
            showSnackbar('Error de autenticación', 'warning');
    
            return false;
        }
    
        configOptions.username = authToken.data.username;
        configOptions.token = authToken.data.token;
        saveConfig();

        return true;
    }

    const filterData = async () => {
        dataObj.filtered = await dbRequest._getAll('cameras');
        
        const words = ! configOptions.searchKeywords.trim().length ? [] : configOptions.searchKeywords.split(',').map(m => m.trim().toLowerCase());

        if (configOptions?.filterStatus) {
            dataObj.filtered = dataObj.filtered.filter(f => configOptions.filterStatus == f.status);
        }

        //OJO: No implementado, hace falta poner hamburger que abra un drawer en el lado izquierdo con todas las areas y cámaras en forma de arbol
        //que puedan ser expandidos y/o contraidos y checkboxes para elegir, si elegimos un nodo principal, se eligen todos los hijos, si quitamos
        //la elección de uno de los hijos, el check del nodo cambia a un estado intermedio.
        //Un filtro o buscardor para reducir la lista para elegir sería un plus muy importante
        if (configOptions?.filterCameras?.length) {
            dataObj.filtered = dataObj.filtered.filter(f => configOptions.filterCameras.includes(f.cameraIndexCode));
        }

        if (specialFilterStoreNames.some((s) => configOptions?.[s]?.length)) {
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
            const prop = filterProps[propIndex];

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
        
        btns.forEach(b => b.setAttr = {disabled: true});
    }

    const enablePagination = () => {
        const btns = q('#pagination a-button', true) || [];
        
        btns.forEach(b => b.remAttr = 'disabled');
    }
    
    const stopAllPlayers = () => {
        for (let i = 0; i < playersObj.play.length; i++) {
            const btn = playersObj.play[i];

            if (btn.$el?.data?.isPlaying) { btn.click(); }
        }
    }

    const createGrid = async () => {
        gridContainer.innerHTML = '';
        
        if (! dataObj.filtered.length) {
            gridContainer.innerHTML = '<h2 class="t-center">No se contraron resultados</h2>';

            return false;
        }

        gridContainer.appendChild(gridPreloader);

        stopAllPlayers();
        
        //Limpiamos el listado
        playersObj.play = [];
        playersObj.capture = [];

        //Si el grid es 4x4
        //0-15, 16-31, 32-47
        const range = {
            from: (configOptions.currentPage - 1) * itemsPerPage[configOptions.gridSize],
            to: (configOptions.currentPage * itemsPerPage[configOptions.gridSize]) - 1,
        }

        for (let i = range.from; i <= range.to; i++) {
            const camera = dataObj.filtered[i];

            if (! camera) { break; }

            const isOnline = camera?.status && camera.status.toString() == '1';
            const isPTZ = camera?.capabilitySet && camera.capabilitySet.toLowerCase().includes('ptz');
            const cameraFullName = [camera.cameraName, camera?.area?.name, camera?.encodingDeviceInfo?.encodeDevName].filter(f => f).join(' - ');
            const videoPlayerContainerId = `video-player--container-${camera.cameraIndexCode}`;
            const videoPlayerWrapper = create('div', {'data-camera-index': camera.cameraIndexCode});
            const videoPlayerContainer = create('div', {id: videoPlayerContainerId}, {className: 'video-player-container'});
            const videoPlayerObject = {
                video: {},
                isOnline,
                captureRetry: false
            };
            const preloader = create('div', false, {className: 'preloader', style: {zIndex: 1001}});
            const nameBadge = `<span class="small">${cameraFullName}</span>`;
            const statusBadge = ! isOnline ? '<a-badge danger pulse>Offline</a-badge>' : '';
            const disableButton = ! isOnline ? ' disabled' : '';
            const btnRefreshStr = ! isOnline ? `<a-button icon circle id="refresh-${camera.cameraIndexCode}" aria-label="Reload Camera"><an-icon refresh></an-icon></a-button>` : '';
            const btnPTZStr = isPTZ ? `
                <a-button icon circle id="ptz-${camera.cameraIndexCode}" aria-label="PTZ commands modal" disabled>
                    <style>
                        .controller {
                            width: 15px;
                            height: 14px;
                            background-image: url('./img/controller.png');
                        }
                    </style>
                    <div class="controller"></div>
                </a-button>
            ` : '';

            videoPlayerWrapper.innerHTML = `
                ${btnRefreshStr}
                <div class="video-controls">
                    <div class="buttons">
                        <a-button icon circle id="play-stop-${camera.cameraIndexCode}" aria-label="Play"${disableButton}><span style="font-size: 1rem; margin:0 0 3px 2px">▶</span></a-button>
                        <a-button icon circle id="capure-${camera.cameraIndexCode}" aria-label="Take Picture" disabled><an-icon camera></an-icon></a-button>
                        ${btnPTZStr}
                        <a-button id="stream-switch-${camera.cameraIndexCode}" aria-label="Reload Camera" disabled>
                            <style>
                                :host(:not([icon])) .body {
                                    padding: 0.1rem 0.3rem 0 0.3rem;
                                }
                            </style>
                            <span data-bind="hilores" style="font-size: 0.85rem;">hi-res</span>
                        </a-button>
                    </div>
                </div>
                <div class="camera-status-container">
                    <div class="camera-status">${statusBadge}</div>
                </div>
                <div class="camera-name-container">
                    <div class="camera-name protected-from-dark">${nameBadge}</div>
                </div>
                <div id="picture-error-msg-${camera.cameraIndexCode}" class="picture-error-container d-none">
                    <div class="picture-error protected-from-dark"><a-button icon circle warning><an-icon x size="1rem"></an-icon></a-button> Error en captura de imagen</div>
                </div>
            `;

            if (camera?.capture?.length) { videoPlayerContainer.style.backgroundImage = `url(${camera.capture})`; }

            videoPlayerWrapper.appendChild(videoPlayerContainer);
            gridContainer.appendChild(videoPlayerWrapper);
            
            const btnRefresh = q(`#refresh-${camera.cameraIndexCode}`);
            const btnPlay = q(`#play-stop-${camera.cameraIndexCode}`);
            const btnCapure = q(`#capure-${camera.cameraIndexCode}`);
            const btnPtz = q(`#ptz-${camera.cameraIndexCode}`);
            const btnStreamSwitch = q(`#stream-switch-${camera.cameraIndexCode}`);
            const picErroMsg = q(`#picture-error-msg-${camera.cameraIndexCode}`);
            
            const imBusy = () => {
                videoPlayerWrapper.appendChild(preloader);
    
                if (btnRefresh) { btnRefresh.setAttr = 'disabled'; }
                
                btnPlay.setAttr = 'disabled';
                btnCapure.setAttr = 'disabled';
                
                if (btnPtz) { btnPtz.setAttr = 'disabled'; }
    
                btnStreamSwitch.setAttr = 'disabled';
            };
    
            const imNotBusy = () => {
                if (btnRefresh) { btnRefresh.remAttr = 'disabled'; }
    
                if (videoPlayerObject.isOnline) {
                    btnPlay.remAttr = 'disabled';
    
                    if (btnPlay?.$el?.data?.isPlaying) {
                        btnCapure.remAttr = 'disabled';

                        if (btnPtz) { btnPtz.remAttr = 'disabled'; }
    
                        btnStreamSwitch.remAttr = 'disabled';
                    }
                }
    
                preloader._remove();
            };

            const takePicture = async (download = false) => {                
                if (! videoPlayerObject.isOnline) { return false; }

                imBusy();

                const timeStamp = new Date().getTime();
                const camFromDB = await dbRequest._get('cameras', {index: 'cameraIndexCode', value: camera.cameraIndexCode});
    
                if (! btnPlay.$el?.data?.isPlaying) {
                    if (! camFromDB?.captureTimestamp || (timeStamp - camFromDB.captureTimestamp) > captureMinTimeBetweenUpdates) {
                        const capture = await runFetch(apiServerUrl + endpoints.protected.capture, {
                            method: 'POST',
                            headers: {
                                authorization: `Bearer ${configOptions.token}`
                            },
                            body: JSON.stringify({id: camera.cameraIndexCode}),
                            timeout: 10000
                        });

                        if (! capture?.data?.length || capture?.data?.code) {
                            picErroMsg.className = '';
                            
                            showSnackbar(`Error al tomar foto en la cámara ${camera.cameraIndexCode}`, 'warning');
                        } else {
                            camFromDB.capture = capture.data;
                            camFromDB.captureTimestamp = timeStamp;
                            dbRequest._put('cameras', camFromDB);

                            videoPlayerContainer.style.backgroundImage = `url(${capture.data})`;

                            picErroMsg.className = 'd-none';

                            console.log('Foto remota tomada a', camera.cameraIndexCode, camFromDB.captureTimestamp);
                        }
                    }
                } else {
                    const canvas = create('canvas');
                    const context = canvas.getContext('2d');
    
                    canvas.width = videoPlayerObject.video.videoWidth;
                    canvas.height = videoPlayerObject.video.videoHeight;
                    context.drawImage(videoPlayerObject.video, 0, 0, canvas.width, canvas.height);
                    
                    const dataUrl = canvas.toDataURL('image/png');

                    camFromDB.capture = dataUrl;
                    camFromDB.captureTimestamp = timeStamp;
                    dbRequest._put('cameras', camFromDB);
    
                    videoPlayerContainer.style.backgroundImage = `url(${dataUrl})`;

                    if (download) {
                        const link = create('a', {href: dataUrl, download: `${camera.cameraIndexCode}_capture_${timeStamp}.png`});
    
                        link.click();
                    }
                }
    
                imNotBusy();

                return true;
            };

            const playStopStream = async (mainStream = false, offlineCheck = false) => {
                if (! offlineCheck && ! videoPlayerObject.isOnline) { return false; }

                imBusy();
    
                if (! btnPlay.$el.data?.newJSPlugin) {
                    btnPlay.$el.data.newJSPlugin = new JSPlugin({
                        szId: videoPlayerContainerId,
                        iWidth: '100%',
                        iHeight: '100%',
                        iMaxSplit: 1,
                        iCurrentSplit: 1,
                        szBasePath: "/jsplugin",
                        oStyle: {
                            border: "none",
                            borderSelect: "transparent",
                            background: "none"
                        }
                    });
    
                    //playersInstancesForWindowResize.push(btnPlay.$el.data.newJSPlugin);
                }
    
                if (! btnPlay.$el?.data?.isPlaying) {
                    console.log(`Iniciando transmisión de cámara ${camera.cameraIndexCode}`);
    
                    try {
                        await btnPlay.$el.data.newJSPlugin.JS_Play(camera.subStream, {
                            playURL: ! mainStream ? camera.subStream : camera.mainStream,
                            auth: "",
                            mode: "media",
                            token: ""
                        }, 0);
    
                        btnPlay.$el.data.isPlaying = true;
                        //btnPlay.$el.body.innerHTML = '<an-icon stop></an-icon>';
                        btnPlay.$el.body.innerHTML = '<span style="font-size: 1rem">⏹</span>';
                        btnPlay.setAttr = {info: true};
    
                        videoPlayerObject.video = videoPlayerContainer.querySelector('video');

                        if (! mainStream) {
                            btnStreamSwitch.remAttr = 'info';
                        } else {
                            btnStreamSwitch.setAttr = {info: true};
                        }

                        if (videoPlayerObject.video?.parentNode) {
                            const jqObj = Object.keys(videoPlayerObject.video.parentNode)?.[0]
                            
                            if (jqObj) {
                                //delete videoPlayerObject.video.parentNode[jqObj].events.dblclick[0].handler;;
                                //delete videoPlayerObject.video.parentNode[jqObj].events.dblclick;
                                delete videoPlayerObject.video.parentNode[jqObj];
                            }
                        }

                        if (offlineCheck) {
                            videoPlayerObject.isOnline = true;

                            btnRefresh._remove();

                            if (camFromDB?.cameraIndexCode) {            
                                camFromDB.status = '1';
                        
                                dbRequest._put('cameras', camFromDB);
                            }
                        }

                        takePicture();
    
                        console.log(`Transmisión de cámara ${camera.cameraIndexCode} iniciada satisfactoriamente`);
                    } catch(err) {
                        console.error(err);
                        
                        showSnackbar(`No se pudo inicar la transmisión de la cámara ${camera.cameraIndexCode}`, 'warning');

                        if (offlineCheck) {
                            btnRefresh.remAttr = 'disabled';
                        }
                    }
                } else {
                    console.log(`Deteniendo transmisión de cámara ${camera.cameraIndexCode}`);
    
                    try {
                        await takePicture();

                        btnPlay.$el.data.newJSPlugin.JS_Stop(0);
                        
                        videoPlayerObject.video = {};
                    } catch (err) {
                        console.error(err);
                    }
    
                    btnPlay.$el.data.isPlaying = false;
                    //btnPlay.$el.body.innerHTML = '<an-icon play></an-icon>';
                    btnPlay.$el.body.innerHTML = '<span style="font-size: 1rem; margin:0 0 3px 2px">▶</span>';
                    btnPlay.remAttr = 'info';

                    btnStreamSwitch.remAttr = 'info';
                }
    
                imNotBusy();

                return true;
            }

            videoPlayerWrapper._on('dblclick', (evt) => {
                const exitFS = ['exitFullscreen', 'webkitExitFullscreen', 'mozExitFullscreen', 'msExitFullscreen'];
                const elcFS = ['requestFullscreen', 'webkitRequestFullscreen', 'mozRequestFullscreen', 'msRequestFullscreen'];
                const docFSE = ['fullscreenElement', 'webkitFullscreenElement', 'mozFullScreenElement', 'msFullscreenElement'];
                const fsExitFnc = exitFS.filter(f => document?.[f])?.[0];
                const fsFnc = elcFS.filter(f => videoPlayerWrapper?.[f])?.[0];
                const isFullscreen = docFSE.some(f => document?.[f]);

                if (! isFullscreen) {
                    videoPlayerWrapper[fsFnc]();
                } else {
                    document[fsExitFnc]();
                }
            });

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
    
                if (btnPlay.$el?.data?.isPlaying) {
                    const hires = ! btnStreamSwitch.getAttr?.['info'];

                    console.log(hires);
                    
                    await playStopStream();//Detenemos el stream actual
                    playStopStream(hires);//Iniciamos el stream de nuevo
                }
            });

            if (btnRefresh) {
                btnRefresh._on('click', async (evt) => {
                    evt.preventDefault();

                    playStopStream(false, true);
                });
            }

            playersObj.play.push(btnPlay);
            playersObj.capture.push(btnCapure);
            btnPlay.$el.data.playStopStream = playStopStream;
            
            if (isOnline && ! camera?.captureTimestamp) {
                (async () => {
                    console.log('Tomando foto remota a', camera.cameraIndexCode);

                    await takePicture();

                    if (! camera?.captureTimestamp && ! videoPlayerObject.captureRetry) {
                        console.log('Intentaremos tomar la foto remota de nuevo a', camera.cameraIndexCode);

                        takePicture();

                        videoPlayerObject.captureRetry = true;
                    }
                })();
            }
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
        const prevButton = create('a-button', {info: true}, {'aria-label': 'Previous', innerHTML: 'Previous'});
        const nextButton = create('a-button', {info: true}, {'aria-label': 'Next', innerHTML: 'Next'});

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

        const selectBox = create('select', false, {style: {width: 'auto'}});

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

        await filterData();

        await createGrid();

        createPagination(isTriggeredByButton);
        enableForm(toolsForm);
        enableForm(filtersDialog.$el['filters-form']);
    }

    if (configOptions.token) {
        const authCheck = await runFetch(apiServerUrl + endpoints.protected.authCheck, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${configOptions.token}`
            }
        });

        if ('success' != authCheck?.status) {
            if (! await login()) { return false; }
        }        
    } else {
        if (! await login()) { return false; }

        const version = await runFetch(apiServerUrl + endpoints.protected.version, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${configOptions.token}`
            }
        });

        showSnackbar(`<h2>${version?.data?.produceName || ''}</h2><h5>${version?.data.softVersion || ''}</h5>`, 'info');

        console.log(version);
    }

    dataObj.local = await dbRequest._getAll('cameras');

    if (! configOptions.lastDBUpdate || (appLoadTimestamp - configOptions.lastDBUpdate) > dbMinTimeBetweenUpdates) {
        if (! configOptions.lastDBUpdate) {
            console.log('Hay que actualizar la base de datos');
        } else {
            console.log(`Base de datos actuazada por última vez el ${getISO8601Timestamp(configOptions.lastDBUpdate)}. Ejecutaremos una nueva actualización`);
        }

        dataObj.remote = await runFetch(apiServerUrl + endpoints.protected.integral, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${configOptions.token}`
            },
            body: JSON.stringify({protocol: 'websocket'}),
            timeout: 60000
        });

        dataObj.remote = dataObj.remote?.data?.list || [];

        //OJO: Estas dos líneas es para simular la respuesta del server
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

        if (1 == f.status) { cameraCount.online++; }
        if (2 == f.status) { cameraCount.offline++; }
    });

    onlineBadge.$el.body.innerHTML = cameraCount.online;
    offlineBadge.$el.body.innerHTML = cameraCount.offline;
    totalBadge.$el.body.innerHTML = cameraCount.online + cameraCount.offline;

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

    gridContainer.className = gridOptions[configOptions.gridSize];

    //Fix para fullscreen en pantallas diferentes a mi laptop
    document.body.appendChild(create('style', false, {innerHTML: `
        :root { --max-width: ${Math.round(screen.width / 1.347368421052632)}px; }
        #camera-grid-wrapper:full-screen { --max-width: ${screen.width}px; }
        #camera-grid-wrapper:-webkit-full-screen { --max-width: ${screen.width}px; }
        #camera-grid-wrapper:-moz-full-screen { --max-width: ${screen.width}px; }
        #camera-grid-wrapper:-ms-full-screen { --max-width: ${screen.width}px; }
    `}));

    /*
    const playersInstancesForWindowResize = [];

    window.onresize = function () {
        playersInstancesForWindowResize.forEach((player) => {
            player.JS_Resize('100%', '100%').then(function () {
                console.log("JS_Resize exitoso");
            }, function () {
                console.error("JS_Resize fallido");
            });
        });
    }*/

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

        gridContainer.className = gridOptions[configOptions.gridSize];
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
        disableForm(toolsForm);
        disableForm(filtersDialog.$el['filters-form']);
        disablePagination();

        let playersPromises = [];

        for (let i = 0; i < playersObj.play.length; i++) {
            if ((! (i % configOptions.gridSize) || i == playersObj.play.length - 1) && playersPromises.length) {
                const result = await Promise.all(playersPromises);

                playersPromises = [];
            }

            const data = playersObj.play[i]?.$el?.data;

            if (! data?.isPlaying) {
                playersPromises.push(data.playStopStream());
            }
        }

        enableForm(toolsForm);
        enableForm(filtersDialog.$el['filters-form']);
        enablePagination();
    });

    btnStopAll._on('click', (evt) => { stopAllPlayers(); });

    btnFullscreenAll._on('click', (evt) => {
        const elcFS = ['requestFullscreen', 'webkitRequestFullscreen', 'mozRequestFullscreen', 'msRequestFullscreen'];
        const docFSE = ['fullscreenElement', 'webkitFullscreenElement', 'mozFullScreenElement', 'msFullscreenElement'];
        const fsFnc = elcFS.filter(f => gridContainerWrapper?.[f])?.[0];
        const isFullscreen = docFSE.some(f => document?.[f]);

        if (! isFullscreen) {
            gridContainerWrapper[fsFnc]();
        }
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