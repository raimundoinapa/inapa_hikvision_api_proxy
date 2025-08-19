(function() {
    "use strict;"

    const { app, create, generateID } = __CPLIB__;
    
    window._on('beforeinstallprompt', (e) => {
        e.preventDefault();//Evita que aparezca la mini-infobar en el móvil
        
        app.installPrompt = e;//Guardamos el evento en una variable
    });

    const getAppMode = () => {
        if (window.matchMedia) {
            if (window.matchMedia('(display-mode: standalone)').matches) { return 'standalone'; }
            if (window.matchMedia('(display-mode: browser)').matches) { return 'browser'; }
        }

        if (document.referrer.indexOf('android-app://') + 1) { return 'twa'; }

        if (window.navigator.standalone) { return 'standalone'; }

        if (navigator.standalone) { return true; }

        return 'browser';
    }

    const isBrowserMode = () => { return 'browser' == getAppMode(); }

    const isStandaloneMode = () => {
        const mode = getAppMode();

        return 'standalone' == mode || 'twa' == mode || false;
    }

    const appInstallPrompt = async () => {
        if (isBrowserMode() && app.installPrompt) {
            const preloader = create('div', false, {className: "bg-overlay preloader", style: {zIndex: 9999999 + 1}});

            document.body.appendChild(preloader);

            app.installPrompt.prompt();
 
            const result = await app.installPrompt.userChoice;

            if ('dismissed' != result.outcome) {
                window._on('appinstalled', () => {
                    app.installPrompt = null;

                    preloader._remove();

                    console.info('PWA instalado');
                });
            } else {
                preloader._remove();

                console.log('Instalación PWA rechazada');
            }
        }
    }

    const areWeOnline = async () => {
        if (! window.navigator.online) { return false; }

        const url = new URL(window.location.origin);

        url.searchParams.set('n', generateID(8));

        try {
            const fetchSelf = await fetch(url, {method: 'HEAD'});

            if (fetchSelf.ok) { return true; }

            return false;
        } catch (err) {
            console.error('Error: ', err);

            return false;
        }
    }

    const functionList = [getAppMode, isBrowserMode, isStandaloneMode, appInstallPrompt, areWeOnline];

    functionList.forEach((n) => { __CPLIB__[n.name] = n; });
})();