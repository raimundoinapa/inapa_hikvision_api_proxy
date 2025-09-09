/*
* CPLib Helper v0.2.0
* https://rcsoft.club.com/cp_lib_v0.2.0/js/helper.js
* Copyright 2011-2021 Raimundo Araujo
* Licensed under (Totally Free, no licence defined)
*/

(() => {
    "use strict;"
    
    const objectName = '__CPLIB__';

    window[objectName] = {
        app: {
            DOMContentLoaded: false,
            installPrompt: null,
            storage: JSON.parse(localStorage.getItem(objectName)) || {appName: 'cpHelper', appVersion: '0.1.0', colorScheme: ''},
            helperScript: document?.currentScript?.src,
            doc: document.documentElement,
            dialogs: [],
            elementHistory: [],
            pushState: function(id, fnc) {
                const currentState = ! this.elementHistory.length ? {} : this.elementHistory[this.elementHistory.length -1];
                
                //Si el id enviado es diferente al id del estado actual, hacemos el push
                if (! currentState || ! currentState.id || currentState.id != id) {
                    history.pushState({id: id}, '', '');//{element: '', id: ''}, title = '', url = ''
        
                    this.elementHistory.push({id: id, fnc: fnc});
                }
            },
            pullState: function(id) {
                for (let h = this.elementHistory.length - 1; h > 0; h--) {
                    if (this.elementHistory[h].id == id) {
                        this.elementHistory.splice(h, 1);
        
                        break;
                    }
                }
            },
            popState: function(e) {
                /*
                * Asuminos que todo lo que se ejecuta por popstate ha sido ejecutado con el back button
                * haciendo caso omiso al forward button para simplificar la interfaz de usuario
                */
                const currentState = this.elementHistory[this.elementHistory.length -1];
        
                //Si el id enviado es diferente al id del estado actual, hacemos el push
                if (currentState && currentState.id && currentState.fnc) { currentState.fnc(e, currentState.id); }
            },
            set: function(key, val) {
                this.storage[key] = val;
                
                localStorage.setItem(objectName, JSON.stringify(this.storage));
            },
            get: function(key) { return this.storage[key]; },
            remove: function(key) {
                delete this.storage[key];

                localStorage.setItem(objectName, JSON.stringify(this.storage));
            }
        }
    };

    var app = window[objectName].app;

    const appendActions = function(elem) {
        if (! elem) { return false; }

        let nt = elem.nodeType;
        let isElement = 1 == nt || 9 == nt;//ELEMENT_NODE || DOCUMENT_NODE (html)
        let isFragment = 11 == nt && 1 != elem?.host?.nodeType;//DOCUMENT_FRAGMENT_NODE sin un host tipo ELEMENT_NODE
        let isText = 3 == nt;//OJO: No esta en uso, pero puede servir de algo en el futuro
        
        if (! elem.$el) { elem.$el = {data: {}}; }//Objeto para apendizar elementos y datos

        //Creo que un elemento script no necesita mas nada
        if ('SCRIPT' == elem?.tagName?.toUpperCase()) {
            elem._insertBefore = _insertBefore;

            return elem;
        }

        elem._event = dispatchEvent;
        
        [_on, _removeOn, select, selectByContent, selectFocusable, containsString].forEach((f) => { elem[('_' + f.name).replace('__', '_')] = f; });
        
        if (isElement && ! elem?._isRoot) {
            elem._remove = removeElem;

            [_insertBefore, _insertAfter, _toggleAttribute, isAttributeTrue, isAttributeFalse, addClass, removeClass, hasClass, softHide].forEach((f) => { elem[('_' + f.name).replace('__', '_')] = f; });
        }
        
        if (isElement || isFragment) {
            //Cualquier elemento descendiente que contenta dataset.bind será apendizado al elemento
            const bind = elem._select('[data-bind]', true);

            for (const b of bind) {
                const bindName = b.dataset.bind;

                if (bindName) { elem.$el[bindName] = b; }
            }
        }

        return elem;
    }

    //let a = select('hijo');
    //let b = elem._select('hijo');
    //let c = elem._select('hijos', true);
    const select = function(elem = '', all = false, context = document, outsideContext = false) {
        let result = [];

        if (this._select) { context = this; }
        if (this._root) { context = this._root; }
        if (context._root) { context = context._root; }

        if ('string' == typeof elem) {
            try {
                document.createDocumentFragment().querySelectorAll(elem);
            } catch(err) {
                console.error('Error: ', err);

                return ! all ? '' : [];
            }

            //result = [...selector(elem)];
            result = ! all ? context.querySelector(elem) : context.querySelectorAll(elem);
            
            if (! all) { result = [result]; } else { result = [...result]; }

            //Si outsideContext es true y no han habido resultados, nos salimos del elemento o componente y seguimos buscando
            if (outsideContext && ! result.length) {
                let parent = context.parentNode || (context.host ? context.host.parentNode : null);
                
                while(parent) {
                    let resultTemp = ! all ? parent.querySelector(elem) : [...parent.querySelectorAll(elem)];

                    if (resultTemp.length) {
                        result = resultTemp;

                        break;
                    }
                    
                    parent = parent.parentNode || (! parent.host ? null : parent.host.parentNode);
                }
            }
            
            if (result.length) {
                if (! all) {
                    appendActions(result[0]);

                    result = result[0];
                } else {
                    result._isCollection = true;//Para ser usado por las las funciones concatenadas que admitan colecciones
                    result._remove = removeElem;
                    result._addClass = addClass;
                    result._removeClass = removeClass;

                    for (const r of result) { appendActions(r); }
                }
            }

            return result;
        }

        return elem;
    }

    const selectByContent = (elem, content, all = false, context = document, outsideContext = false) => {
        //(e.textContent.match(content) || []) //Con esta forma pudieramos usar expresiones regulares 
        const result = select(elem, true, context, outsideContext).filter((e) => e.textContent.toLowerCase().indexOf(content.toLowerCase()) + 1);

        return ! all ? result[0] : result;
    }

    const selectFocusable = (context = document, includeDisabledItems = false) => {
        let query = 'a[href], button, input, select, textarea, details, summary, embed, object, iframe, [tabindex], [autofocus], [contenteditable], [data-autofocus], a-button, a-hamburger, dark-mode-toggler';

        if (! includeDisabledItems) { query += ':not([tabindex="-1"])'; }

        let focusableElements = select(query, true, context);
        let focusable = [];

        if (! includeDisabledItems) {
            for (let f of focusableElements) {
                if (f.offsetWidth > 0 && f.offsetHeight > 0) {
                    let ti = f.getAttribute('tabindex');

                    if (ti && '-1' == ti) { continue; }

                    if (f._isAttributeFalse('disabled') && f._isAttributeFalse('aria-hidden')) { focusable.push(f); }
                }
            }
        } else {
            focusable = focusableElements;
        }

        return focusable;
    }

    //Remueve un elemento o los hijos especificados de este
    const removeElem = function(elem, children) {
        if (this._remove) {
            children = elem;
            elem = this;
        }

        if ('string' == typeof elem) { elem = select(elem, true); }

        if (! elem) { return false; }

        if (! elem._isCollection) {
            let nt = elem.nodeType;
            
            //#document-fragment que no es shadowRoot
            if (11 == nt && 1 != nt?.host?.nodeType) { elem = elem.childNodes; } else { elem = [elem]; }
        }

        for(let e of elem) {
            if (children) {
                if ('string' == typeof children) {
                    children = e._select(children, true);

                    for(let c of children) { c.parentNode.removeChild(c); }
                } else {
                    e.removeChild(c);
                }
            } else {
                if (e.parentNode) { e.parentNode.removeChild(e); }
            }
        }
    }

    //Clase puede ser un string con una o varias clases separadas por un espacio o puede ser un array de clases
    const addClass = function(elem, clase) {
        if (this._addClass) {
            clase = elem;
            elem = this;
        }

        if ('string' == typeof elem) { elem = select(elem, true); }

        if (! elem || ! clase) { return false; }

        if (! elem._isCollection) { elem = [elem]; }
        
        if ('string' == typeof clase) {
            clase = strCleanUp(clase);

            if (/\s+/.test(clase)) { clase = clase.split(' '); } else { clase = [clase]; }
        }

        for(let eac of elem) { for (let c of clase) { eac.classList.add(c); } }
    }

    const removeClass = function(elem, clase) {
        if (this._removeClass) {
            clase = elem;
            elem = this;
        }        

        if ('string' == typeof elem) { elem = select(elem, true); }
        
        if (! elem || ! clase) { return false; }

        if (! elem._isCollection) { elem = [elem]; }

        if ('string' == typeof clase) {
            clase = strCleanUp(clase);

            if (/\s+/.test(clase)) { clase = clase.split(' '); } else { clase = [clase]; }
        }

        for(let erc of elem) { for (let r of clase) { erc.classList.remove(r); } }
    }

    const hasClass = function(elem, clase) {
        if (this._hasClass) {
            clase = elem;
            elem = this;
        }
        
        if (! elem || ! clase) { return false; }

        return elem.classList && elem.classList.contains(clase);
    }

    /*
        MutationObserver

        Todos los valores vienen en false por defecto.

        childList: true, Monitoria la adición o remoción de nodos hijos (Nietos, etc si subtree es true) del elemento.
        attributes: true, Monitoreao cambios, adición o remoción de atributos del elemento (Nietos, etc si subtree es true)
        attributeFilter: ['attr1', 'attr2'], Filtra los atributos que se quieren monitorear
        attributeOldValue: true, Adiciona el valor anterior de los atributos a la respuesta de retorno
        characterData: true, Motorea si se escribió algo en el elemento (algun input o contenteditable) (Nietos, etc si subtree es true)
        subtree: true, Adicional al elemento, monitorea los sub arboles, de los hijos en adelante, para todas las opciones

        opts: {
            childList: true, subtree: true,
            attributes: true, attributeFilter: ['class', 'aria-pressed', ...], attributeOldValue: true
            characterData: true, motorea si se escribió algo  en el nodo (contenteditable) y en los hijos si subtree es true
        }

        Aquí en la función observeMutation por defecto se retorna los atributos mutados
        (onlyAttributes = true), si si pone en false, se envia todo el objeto
    */
    const observeMutation = function(elem, options, fnc, onlyAttributes = false) {
        if (! options) { return console.error(`${this.name} error: No se proveyeron opciones.`); }

        if ('string' == typeof options) { options = [options]; }

        const observer = new MutationObserver((mutations) => {
            if (onlyAttributes) {
                const m = mutations[0];

                //console.log(elem.getAttribute(m.attributeName), m);

                //OJO Ver qué valor m.target[m.attributeName] contiene
                if (fnc) { fnc(m.attributeName, m.oldValue, m.target[m.attributeName], mutations); }

                return false;
            }

            if (fnc) { fnc(mutations); }
        });

        observer.observe(elem, options);

        return observer;
    }

    const observeAttributes = function(elem, fnc, filter) {
        const options = {
            attributes: true,
            attributeOldValue: true
        }

        if (filter) {
            if ('string' == typeof filter) { filter = [filter]; }

            options.attributeFilter = filter;
        }
        
        return observeMutation(elem, options, fnc, true);
    }

    const observeText = function(elem, fnc) {
        const options = {
            characterData: true,
            attributes: false,
            attributeOldValue: false,
            childList: true
        }
        
        return observeMutation(elem, options, fnc);
    }

    const observeChildren = function(elem, fnc) {
        const options = {
            characterData: false,
            attributes: false,
            attributeOldValue: false,
            childList: true,
            subtree: true
        }
        
        return observeMutation(elem, options, fnc);
    }

    const dispatchEvent = function(elem, e, o = {}) {
        if (this._event) {
            o = e;
            e = elem;
            elem = this;
        }

        const mouseEvents = ['click', 'mouseup', 'mousedown'];
        const keyEvents = {
            'keydown': {},
            'keyup': {},
            'keypress': {},
        };

        ['Enter', 'Escape', 'Tab', 'Delete', 'Backspace', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowRight', {key: 'Shift', code: 'ShiftLeft'}, {key: 'Shift', code: 'ShiftRight'}, {key: 'Control', code: 'ControlLeft'}, {key: 'Control', code: 'ControlRight'}, {key: 'Alt', code: 'AltLeft'}, {key: 'Alt', code: 'AltRight'}].forEach((k) => {
            const evtObj = {isTrusted: true, bubbles: true, key: ! k?.key ? k : k.key};
            /*
                evtObj.ctrlKey = false;
                evtObj.metaKey = false;
                evtObj.altKey = false;
                evtObj.shiftKey = false;
            */

            if (k?.code) { evtObj.code = k.code; }

            keyEvents[! evtObj?.code ? evtObj.key.toLowerCase() : evtObj.code.toLowerCase()] = ['keydown', evtObj];
        });
        
        const eventType = ! mouseEvents.includes(e) ? ! keyEvents.hasOwnProperty(e) ? Event : KeyboardEvent : MouseEvent;
        
        if (eventType == KeyboardEvent && Array.isArray(keyEvents[e])) {
            if (! Object.keys(o)?.length) { o = keyEvents[e][1]; }

            e = keyEvents[e][0];
        }

        elem.dispatchEvent(new eventType(e, o));
    }

    //OJO: No implementado
    const dispatchCustomEvent = function(elem, e, o = {}) {
        if (this._event) {
            o = e;
            e = elem;
            elem = this;
        }

        //elem.dispatchEvent(new CustomEvent(evtName, {detail: {test: 'test'}, bubbles: true, composed: true}));
    }

    const isAttributeTrue = function(elem, attr) {
        if (this._isAttributeTrue) { return ! this._isAttributeFalse(elem, attr); }

        return ! isAttributeFalse(elem, attr);
    }

    const isAttributeFalse = function(elem, attr) {
        if (this._isAttributeFalse) {
            attr = elem;
            elem = this;
        }

        let a = elem.getAttribute(attr);

        return ! elem.hasAttribute(attr) || false === a || 'false' === a;
    }

    const containsString = function(strOrDom, subString) {
        if (this._containsString) {
            subString = strOrDom;
            strOrDom = this;
        }

        if (! strOrDom || ! subString) { return false; }
        
        if (strOrDom.innerHTML) { strOrDom = strOrDom.innerHTML; }

        return strOrDom.toLowerCase().indexOf(subString.toLowerCase()) + 1;
    }

    const softHide = function(elem) {
        if (this._softHide) { elem = this; }
        
        elem.style.visibility = 'hidden';
        elem.style.position = 'absolute';
    }

    /****************************************************************************************************************/

    /*
        * Métodos personalizados para componentes o elementos pasados por appendActions
        enterup, enterdown, 
        escapeup, escapedown, 
        spacebarup, spacebardown, 
        arrowkeysup, arrowkeysdown, 
        uparrowup, uparrowdown, 
        rightarrowup, rightarrowdown, 
        downarrowup, downarrowdown, 
        leftarrowup, leftarrowdown, 
        attributechange, 
        classchange, 
        textchange, 
        childrenchange, 
        adopt (Solo para componentes), 
        unmount (Solo para componentes)

        * Esta función puede agregar métodos y/o propiedades adicionales como _customEvents, _onAttributeChange, o _classChangeEvent para mantener
        * un control de eventos al momento de que se necesiten remover con _removeOn
        * 
        * Los componentes con eventos click adicionalmente se le dan soporte de enter y barra espaciadora
    */
    const _on = function() {
        /*
            * Los eventos como blur y focus no hacen bubble
            * Para capturarlos desde afuera de forma global se pone el tercer parametro del addEventListener "use capture" en true
            * document.addEventListener('blur', function(event) { console.log(event); }, true);
            * 
            * Para remover un eventListener personalizado como enterup, enterdown, etc, la función delvuele todos los argumentos, 
            * con la función de callback ya modificada, pero ser removida como window._removeOn(...referencia);
        */
        let args = arguments;
        const evtName = args[0];
        const fnc = args[1];
        const filters = args[2];
        
        const evtMap = {
            enterup: {evt: 'keyup', keys: [13]},
            enterdown: {evt: 'keydown', keys: [13]},
            escapeup: {evt: 'keyup', keys: [27]},
            escapedown: {evt: 'keydown', keys: [27]},
            spacebarup: {evt: 'keyup', keys: [32]},
            spacebardown: {evt: 'keydown', keys: [32]},
            arrowkeysup: {evt: 'keyup', keys: [37, 38, 39, 40]},
            arrowkeysdown: {evt: 'keydown', keys: [37, 38, 39, 40]},
            uparrowup: {evt: 'keyup', keys: [37]},
            uparrowdown: {evt: 'keydown', keys: [37]},
            rightarrowup: {evt: 'keyup', keys: [38]},
            rightarrowdown: {evt: 'keydown', keys: [38]},
            downarrowup: {evt: 'keyup', keys: [39]},
            downarrowdown: {evt: 'keydown', keys: [39]},
            leftarrowup: {evt: 'keyup', keys: [40]},
            leftarrowdown: {evt: 'keydown', keys: [40]}
        };

        const observableEvents = {
            'attributechange': {
                'onEvt': '_onAttributeChange',
                'evtType': '_attributeChangeEvent',
                'filters': false,
                'observer': observeAttributes
            },
            'classchange': {
                'onEvt': '_onClassChange',
                'evtType': '_classChangeEvent',
                'filters': 'class',
                'observer': observeAttributes
            },
            'textchange': {
                'onEvt': '_onTextChange',
                'evtType': '_textChangeEvent',
                'filters': false,
                'observer': observeText
            },
            'childrenchange': {
                'onEvt': '_onChildrenChange',
                'evtType': '_childrenChangeEvent',
                'filters': false,
                'observer': observeChildren
            }
        }

        if (evtMap[evtName]) {
            const alteredFunction = ((e) => {
                const eName = evtName;
                const eKeys = evtMap[eName].keys;
                const eFnc = fnc;
                
                return (e) => {
                    if (eKeys.includes(e?.which)) {
                        if ('spacebardown' == eName) { e.preventDefault(); }//Evita scroll

                        eFnc(e);
                    }
                }
            })();

            args = [evtMap[evtName].evt, alteredFunction, args[2] !== void 0 ? args[2] : false];

            const target = this != window ? Element : EventTarget;

            target.prototype.addEventListener.apply(this, args);
            
            return args;//Se devuelven los argumentos, para poder remover el eventListener
        }

        if (observableEvents[evtName]) {
            //Si es un host, tratamos de usar el _onXxxChange primero, de lo contrario vamos al MutationObserver
            if (this?._isHost && this?.currentlyObserved?.length && ('attributechange' == evtName || 'classchange' == evtName)) {
                this[observableEvents[evtName]['onEvt']] = fnc;

                return false;
            }

            this[observableEvents[evtName]['evtType']] = observableEvents[evtName]['observer'](this, fnc, observableEvents[evtName]['filters']);

            return false;
        }

        /* if ('attributechange' == evtName) {
            //Si es un host, tratamos de usar el _onAttributeChange primero, de lo contrario vamos al MutationObserver
            if (this._isHost && this.currentlyObserved?.length) {
                this._onAttributeChange = fnc;

                return false;
            }

            this._attributeChangeEvent = observeAttributes(this, fnc, filters);

            return false;
        }

        if ('classchange' ==  evtName) {
            //Si es un host, tratamos de usar el _onAttributeChange primero, de lo contrario vamos al MutationObserver
            if (this._isHost && this?.currentlyObserved?.length) {
                this._onClassChange = fnc;
                
                return false;
            }

            this._classChangeEvent = observeAttributes(this, fnc, 'class');

            return false;
        }

        if ('textchange' == evtName) {
            //Si es un host, tratamos de usar el _onAttributeChange primero, de lo contrario vamos al MutationObserver
            if (this._isHost && this.currentlyObserved?.length) {
                this._onTextChange = fnc;

                return false;
            }

            this._textChangeEvent = observeText(this, fnc);

            return false;
        }

        if ('childrenchange' == evtName) {
            //Si es un host, tratamos de usar el _onAttributeChange primero, de lo contrario vamos al MutationObserver
            if (this._isHost && this.currentlyObserved?.length) {
                this._onChildrenChange = fnc;

                return false;
            }

            this._childrenChangeEvent = observeChildren(this, fnc);

            return false;
        } */

        //Solo para componentes
        if ('adopt' == evtName) {
            this._onAdopt = fnc;

            return false;
        }

        //Solo para componentes
        if ('unmount' == evtName) {
            this._onUnmount = fnc;

            return false;
        }

        /* Anadimos soporte extra al click en componentes */
        if ('click' == evtName && this._isHost) {
            if (! this._customEvents) { this._customEvents = []; }

            //Hacemos esto para poder remover estos eventos en caso de que se remueve el evento click
            this._customEvents = [];
            this._customEvents.push(this._on('enterdown', fnc));
            this._customEvents.push(this._on('spacebardown', fnc));
        }

        //Si llagamos a esta punto es un evento común o un dispatchEvent(new CustomEvent('customevent'))
        return this != window ? Element.prototype.addEventListener.apply(this, args) : EventTarget.prototype.addEventListener.apply(this, args);
    };

    const _removeOn = function() {
        const args = arguments;
        const evtName = args[0];
        const fnc = args[1];

        const evtNames = ['attributechange', 'classchange', 'textchange', 'childrenchange'];
        const thisEvtNames = ['_attributeChangeEvent', '_classChangeEvent', '_textChangeEvent', '_childrenChangeEvent'];
        const evtIndex = evtNames.indexOf(evtName);

        if (evtIndex + 1) {
            if (this?.[thisEvtNames[evtIndex]]) { this[thisEvtNames[evtIndex]].disconnect(); }

            return false;
        }

        /* Eliminamos los ventos extras añadidos al click en componentes */
        if ('click' == evtName && this._isHost && this._customEvents) { this._customEvents.forEach((ce) => { target._removeOn(...ce); }); }

        //Si llagamos a esta punto es un evento común o un dispatchEvent(new CustomEvent('customevent'))
        return this != window ? Element.prototype.removeEventListener.apply(this, args) : EventTarget.prototype.removeEventListener.apply(this, args);
    };

    /*
    * Uso:
    * element._toggleAttribute('attrname');//Nativo, remueve o quita el atributo de forma automática
    * element._toggleAttribute('attrname', true);//Nativo, agrega el atributo
    * element._toggleAttribute('attrname', false);//Nativo, remueve el atributo
    * element._toggleAttribute('attrname', 'cadena');//Agrega el atributo con el valor de la cadena
    * //Evalua los valores como cadenas y agrega el atributo con el valor correspondiente
    * element._toggleAttribute('attrname', true, false | 'true', 'false' | ['true', 'false']);
    * Tambien tenemos un alias element._toggleAttribute
    */
    const _toggleAttribute = function(name, force, attr) {
        if (! name) { return false; }

        if (force === void 0 || ('boolean' == typeof force && attr === void 0)) {
            return Element.prototype.toggleAttribute.apply(this, arguments);
        }

        let attrA = force.toString();
        let attrB = attr !== void 0 ? attr.toString() : false;
        let elemAttr = this.getAttribute(name);

        //Si el atributo no existe en el elemento, lo agregamos con el primer atributo
        if (null == elemAttr) {
            this.setAttribute(name, attrA);

            return true;
        }

        //Si el existe pero no se envió un valor B para reemplazar su valor actual, hay que remover el atributo como tal
        if (! attrB) {
            this.removeAttribute(name);

            return true;
        }

        //Aquí intercambiamos valores de atributo
        this.setAttribute(name, elemAttr != attrA ? attrA : attrB);
    };

    const _insertBefore = function(newNode, referenceNode) {
        if (! newNode) { return false; }

        const ib = Element.prototype.insertBefore;
        const sib = HTMLScriptElement.prototype.insertBefore;

        if ('string' == typeof newNode) { newNode = htmlToNode(newNode); }

        if (referenceNode) {
            if ('SCRIPT' == this?.tagName?.toUpperCase()) { return sib.apply(this, [newNode, referenceNode]); }

            return ib.apply(this, [newNode, referenceNode]);
        }

        if ('SCRIPT' == this?.tagName?.toUpperCase()) { return sib.apply(this.parentNode, [newNode, this]); }

        //Equivalente a node.parentNode.insertBefore(newNode, node) //insertAdjacentElement no acepta DocumentFragment
        ib.apply(this.parentNode, [newNode, this]);
    };

    const _insertAfter = function(newNode, referenceNode) {
        if (! newNode) { return false; }

        if ('string' == typeof newNode) { newNode = htmlToNode(newNode); }

        const ib = Element.prototype.insertBefore;

        if (referenceNode) {
            ib.apply(this, [newNode, referenceNode]);

            return ib.apply(this, [referenceNode, newNode]);
        }

        ib.apply(this.parentNode, [newNode, this]);
        ib.apply(this.parentNode, [this, newNode]);
    }

    /****************************************************************************************************************/

    const onDomReady = (fnc, params) => {
        if (! app.DOMContentLoaded) {
            window._on('DOMContentLoaded', () => {
                fnc(params);
    
                app.DOMContentLoaded = true;//Servirá para evitar usar DOMContentLoaded mas de una vez
            });
        } else {
            fnc(params);
        }
    }

    /*
    Ej:
    let m = create(['form', {is: 'super-form'}], {id: 'id'}, {className: 'classname'}, (f) => { //... });
    let n = create('div', {id: 'id'});
    El parámetro fnc es una función que será apendizada al elemente como _fnc y podrá ser ejecutada manualmente
    */
    const create = function(tag, attr, prop, fnc) {
        let elem = 'string' == typeof tag ? document.createElement(tag) : document.createElement(tag[0], tag[1]);

        //{id: 'btn-close, name: 'btn-close, value: 'btn-close}
        if (attr) { for (let a in attr) { elem.setAttribute(a, attr[a]); } }

        //{className: 'btn-close', style: {backgroundColor: '#fff'}}
        if (prop) {
            for (const [p, v] of Object.entries(prop)) {
                //fnc puede llegar dentro de prop o directamente en fnc
                if('fnc' == p) {
                    fnc = v;
                    continue;
                }

                if ('string' == typeof v) {
                    elem[p] = v;
                    continue;
                }

                if ('object' == typeof v) { for (let pp in v) { elem[p][pp] = v[pp]; } }
            }
        }

        if (fnc) { elem._fnc = fnc; }

        appendActions(elem);

        return elem;
    }

    const createStyle = (styleStr) => {
        let style = create('style');
        style.appendChild(document.createTextNode(styleStr));

        return style;
    }

    //Transforma una cadena en un Nodo y devuelve el nuevo nodo o su contenido en forma de nodo o lo inserta en el elemento al que se le haya apendizado la función
    const htmlToNode = function(html) {
        /* let tmpl = create('template', false, {innerHTML: html});
        let node = tmpl.content.cloneNode(true);

        return appendActions(node); */

        //OJO: Vamos a probar con esta nueva a forma a ver que pasa
        return appendActions(document.createRange().createContextualFragment(html));
    }

    const cloneNode = function(node) {
        let tmpl = create('template');
        
        tmpl.appendChild(node);

        return tmpl.content.cloneNode(true);
    }

    const isElement = (elem) => { return elem.nodeType && (1 == elem.nodeType || 9 == elem.nodeType); }

    const isTextBox = (elem) => {
        return /text|password|email|tel|url|search/.test(elem?.type?.toLowerCase()) || 'TEXTAREA' == elem?.tagName?.toUpperCase();
    }
    
    const strCleanUp = (str) => {
        return str.replace(/^(?:(\r\n)|\r|\n|\t|\f|\s|\u00A0)+|(?:(\r\n)|\r|\n|\t|\f|\s|\u00A0)+$/g, '').replace(/(?:(\s*\r\n\s*)|(\s*\r\s*)|(\s*\n\s*))+/g, "\r\n").replace(/(?:\s{2}\s*)+|(?:\u00A0)+/g, ' ');
    }

    //OJO: interpretar el funcionamiento de esta función, no la comprendo, la obtube de stackoverflow
    const strStripTags = (html, ...args) => {
        return html.replace(/<(\/?)(\w+)[^>]*\/?>/g, (_, endMark, tag) => {
            return args.includes(tag) ? '<' + endMark + tag + '>' : '';
        }).replace(/<!--.*?-->/g, '');
    }

    const strReplace = (str, replace, replacement) => {
        if (! replacement) { replacement = ''; }

        if ('string' == typeof replace) { replace = [replace]; }

        let s = 0;

        if ('string' == typeof replacement) {
            for (; s < replace.length; s++) {
                str = str.replace(new RegExp(replace[s], 'gi'), replacement);
            }
        } else {
            for (; s < replace.length; s++) {
                str = str.replace(new RegExp(replace[s], 'gi'), replacement[s]);
            }
        }

        return str;
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

    const generateID = (len = 12) => {
        let id = '';
        let chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

        for (i = 0; i < len; i++) { id += chars.charAt(Math.floor(Math.random() * chars.length)); }

        return id;
    }

    const pad = (n, count = 4, padder = '0') => { return String(n).padStart(count, padder); }

    /* Funciones para deshabilitar y habilitar formularios y elementos */
    const enableDisableToggle = (elem, trueOrFalse) => {
        //Los fieldset deshabilitados afectan a sus hijos, por esta razón decidimos solo aplicarles la propiedad readonly que en conjunto con los estilos dan la apariencia de que se encuentran deshabilitados
        if ('FIELDSET' != elem.tagName.toUpperCase()) {
            elem.toggleAttribute('disabled', trueOrFalse);
            elem.toggleAttribute('aria-disabled', trueOrFalse);
        }
        
        elem.toggleAttribute('readonly', trueOrFalse);
    }

    const disableForm = (frm, d = true) => {
        let f = frm.elements.length - 1;

        for (; f > -1 ; f--) {
            let i = frm.elements[f];
            
            enableDisableToggle(i, d);
                
            if ('SELECT' == i.tagName.toUpperCase()) { for (let eso of i.selectedOptions) { enableDisableToggle(eso, d); } }
        }

        //Aquí comprobamos que frm sea realmente un formulario
        if ('FORM' == frm?.tagName?.toUpperCase()) {
            let links = select('a', true, frm);

            for (const l of links) { enableDisableToggle(l, d); }
        }
    }

    const enableForm = (frm) => { disableForm(frm, false); }
    const disableElement = function() { disableForm({elements: [...arguments]}); }
    const enableElement = function() { enableForm({elements: [...arguments]}); }

    /* Funciones para números */
    const isFloat = n => ('number' == typeof n && ! Number.isNaN(n) && ! Number.isInteger(n)) || /^\-?\d+(\.{1}\d+)?$/.test(n)

    //https://stackoverflow.com/questions/11832914/how-to-round-to-at-most-2-decimal-places-if-necessary
    const roundToTwo = function(num, formatLocale) {
        /*
        * El +al inicio transforma la cadena en un número, ya que e+2 lo transforma en un string,
        * e+2 es la representación exponencial del numero, corriendo el punto dos positiones a la derecha y e-2 hace lo contrario
        */
        num = +(Math.round(num + "e+2")  + "e-2");
        
        if (formatLocale) { num = num.toLocaleString(undefined, { minimumFractionDigits: 2 }); }
        
        return num;
    }

    const randomNumber = (min = 0, max = 100) => {
        if (min && ! max) {
            max = min;
            min = 0;
        }
        
        //return Math.floor(Math.random() / (1 / (max - min + 1))) + min;
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    const shuffle = (arr = []) => {
        const arrTemp = [];

        const randomPick = () => {
            arrTemp.push(arr.splice(Math.floor(Math.random() * arr.length), 1)[0]);

            if (arr.length) { randomPick(); }
        }

        randomPick();
        
        return arrTemp;
    }

    //Remueve duplicados en arrays de 1 dimensión, ya sea de datos primitivos u objetos, para los objetos, se debe indicar qué campo será único
    const arrayUnique = (arr = [], uniqueProp = '') => {
        if (! uniqueProp) { return [...new Set(arr)]; }

        const objTemp = {};

        arr.forEach((o) => { objTemp[o[uniqueProp]] = o });

        return Object.values(objTemp);
    }

    /* Funciones para fechas */
    const getTimestamp = (date = false) => {
        const d = ! date ? new Date() : new Date(date);
        
        return new Date(d - d.getTimezoneOffset() * 60 * 1000).toJSON().replace('T', ' ').split('.')[0];
    }

    const getISO8601Timestamp = (date = false) => {
        const d = ! date ? new Date() : new Date(date);
        const tzo = d.getTimezoneOffset();
        const timezone = tzo == 0 ? '00:00' : (tzo > 0 ? '-' : '+') + (tzo / 60).toFixed(2).split('.').map((e, i) => (i > 0 ? (Math.round(60 * Number('0.' + e))).toString() : e).padStart(2, '0')).join(':');
        
        return new Date(d - tzo * 60 * 1000).toJSON().replace('Z', timezone);
    }

    const getLocalDate = (iso = 'es-VE', date = false) => {
        return new Intl.DateTimeFormat(iso, {year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(date));
    }

    //OJO: Ver como se implemente la traducción
    const getRelativeDate = (olderDate, newerDate) => {
        if ('string' == typeof olderDate) { olderDate = new Date(olderDate); }
        if ('string' == typeof newerDate) { newerDate = new Date(newerDate); }

        if (! newerDate) { newerDate = new Date(); }

        //[Hace 1-59 minutos, Hace 1-23 horas, Hace 1-6 dias, Hace 1-3 semanas, Hace 1-11 meses, Hace 1-9 años, Hace 1-9 décadas, Hace 1-9 siglos, Hace 1-5 milenios]
        let dateStr = '';

        const n = [
            {new: newerDate.getFullYear(), old: olderDate.getFullYear(), label: 'año', limit: 10},
            {new: newerDate.getMonth(), old: olderDate.getMonth(), label: 'mes', limit: 12},
            {new: newerDate.getDate(), old: olderDate.getDate(), label: 'dia', limit: 31},
            {new: newerDate.getHours(), old: olderDate.getHours(), label: 'hora', limit: 24},
            {new: newerDate.getMinutes(), old: olderDate.getMinutes(), label: 'minuto', limit: 60},
            {new: newerDate.getSeconds(), old: olderDate.getSeconds(), label: 'segundo', limit: 60}
        ];

        for (let o of n) {
            if (o.new && o.old) {
                let diff = o.new - o.old;

                if (diff > 0 && diff < o.limit) {
                    if (diff > 1 && 'mes' == o.label) { o.label = 'mese'; }
                    
                    dateStr += 'Hace ' + diff + ' ' + o.label + (diff > 1 ? 's' : '');

                    if ('dia' == o.label) {
                        let weeks = Math.floor(diff / 7);

                        if (weeks > 0 && weeks < 4) { dateStr = 'Hace ' + weeks + ' semana' + (weeks > 1 ? 's' : ''); }
                    }
                    break;
                }
            }
        }

        return dateStr;
    }

    const getTimeDifference = (oldDate = null, newDate = null) => {
        oldDate = ! oldDate ? new Date() : 'string' != typeof oldDate ? oldDate : new Date(oldDate);
        newDate = ! newDate ? new Date() : 'string' != typeof newDate ? newDate : new Date(newDate);

        const diff = Math.round((newDate.getTime() - oldDate.getTime()) / 1000);

        const s = diff % 60;
        const m = (diff - s) / 60 % 60;
        const h = (diff - s - (m * 60)) / 60 / 60;

        return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}`;
    }

    const getRamdomDateBetween = (start, end) => {
        start = Date.parse(start);
        end = Date.parse(end);

        return new Date(Math.floor(Math.random() * (end - start + 1) + start));
    }

    /* Funciones para cookies, localStorage y sessionStorage */
    const getCookies = (cookieName = '') => {
        const cookies = decodeURIComponent(document.cookie).split(';').map((c) => c.trim());

        if (! cookieName) { return cookies; }

        for (const c of cookies) {
            if (c.startsWith(cookieName + '=')) { return c.split('=')[0]; }
        }
        
        return '';
    }
    
    const clearStorage = () => {
        return new Promise(async (resolve) => {
            document.cookie.split(';').forEach((c) => { document.cookie = `${c.split('=').shift().trim()}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`; });
            localStorage.clear();
            sessionStorage.clear();

            if (window?.indexedDB?.databases) {
                const dbs = await window.indexedDB.databases();

                if (dbs?.length) {
                    dbs.forEach(async (d) => {
                        const dbDeleteRequest = window.indexedDB.deleteDatabase(d.name);

                        dbDeleteRequest.onerror = (event) => {
                            console.error(`Error deleting database ${d.name}`, event);
                        };

                        dbDeleteRequest.onsuccess = (event) => {
                            console.log(`Database ${d.name} deleted successfully`, event);
                        };
                    });
                }
            }

            if ('caches' in window) {
                try {
                    const cacheNames = await caches.keys();
                    
                    for (const cacheName of cacheNames) {
                        const deleted = await caches.delete(cacheName);

                        console.log((! deleted ? 'Failed to delete cache' : 'Deleted cache') + `: ${cacheName}`);
                    }
                } catch (error) {
                    console.error('Error fetching or deleting caches:', error);
                } finally {}
            }

            resolve(true);
        });
    }

    const exportStorage = (textFile = false) => {
        return new Promise(async (resolve) => {
            const data = { cookies: {}, localStorage: {}, sessionStorage: {} };

            //Esto no extrae la metadata de las cookies, tales como path, expires, domain y secure, asÃ­ que lo menos que se puede hacer al importarlas ex aÃ±adir el ;path=/
            document.cookie.split(';').forEach((c) => {
                const parts = c.split('=');
                const name = parts.shift().trim();
                const value = parts.join('=').trim();

                data.cookies[name] = value;
            });
            Object.keys(localStorage).forEach((k) => { data.localStorage[k] = localStorage[k]; });
            Object.keys(sessionStorage).forEach((k) => { data.sessionStorage[k] = sessionStorage[k]; });

            if (textFile) {
                let ip = '';
                const date = new Date();
                const dateStr = new Date(date - date.getTimezoneOffset() * 60 * 1000).toJSON().replace('T', ' ').replace(' ', '_').replace(/\:/g, '-').replace('.', '_');
                const file = new Blob([JSON.stringify(data)], { type: 'text/plain' });

                try {
                    const ipFetch = await fetch('https://api.ipify.org?format=json', {mode: 'cors'});
                    const ipFetchResult = await ipFetch.json();
        
                    if (ipFetchResult?.ip) { ip = `_${ipFetchResult.ip}`; }
                } catch (error) {
                    console.warn('Error fetching ip:', error);
                } finally {}
                
                const fileName = `${window.location.hostname}_storage${ip}_${dateStr}.txt`;
                const link = document.createElement('a');

                link.href = URL.createObjectURL(file);
                link.download = fileName;
                link.click();
                
                URL.revokeObjectURL(link.href);
            }
            
            resolve(data);
        });
    }

    const importStorage = (data = {cookies: {}, localStorage: {}, sessionStorage: {}}) => {
        return new Promise(async (resolve) => {
            if ('string' === typeof data) { data = JSON.parse(data); }
            if (data.cookies) { Object.keys(data.cookies).forEach((k) => { document.cookie = `${k}=${data.cookies[k]};path=/`; }); }//Al menos aÃ±adimos el metadata path ya que los metadata no pueden ser exportados
            if (data.localStorage) { Object.keys(data.localStorage).forEach((k) => { localStorage.setItem(k, data.localStorage[k]); }); }
            if (data.sessionStorage) { Object.keys(data.sessionStorage).forEach((k) => { sessionStorage.setItem(k, data.sessionStorage[k]); }); }

            resolve(true);
        });
    }
    
    /* Funciones para fetch, carga de imágenes y otros recursos */
    const runFetch = async (endpoint = '', options = {}, hasCustomUpperLevelOptions = false) => {
        if (! endpoint || 'string' !== typeof endpoint || '' == endpoint.trim()) {
            throw new Error('Invalid or missing endpoint');
        }

        const result = {
            res: {},
            httpStatusCode: 200,
            httpStatusText: 'OK',
            status: 'success',
            data: {}
        };

        const fetchOptionKeys = [
            'method', 'headers', 'body', 'mode', 'credentials', 'cache', 'redirect', 'referrer',
            'referrerpolicy', 'signal', 'integrity', 'keepalive', 'priority'
        ].map(k => k.toLowerCase());

        const defaultOpts = {
            method: 'GET',
            headers: {
                accept: 'application/json, text/plain, */*'
            },
            signal: AbortSignal.timeout(Number(10000))
        };

        if (! options || 'object' !== typeof options || ! Object.keys(options)?.length) {
            options = defaultOpts;
        }

        const abortKey = Object.keys(options).find(o => ['abort', 'signal', 'timeout'].includes(o.toLowerCase()));

        if (abortKey) {
            const signalValue = options[abortKey];
            
            if (signalValue instanceof AbortSignal) {
                defaultOpts.signal = signalValue;
            } else if (/^\d+$/.test(signalValue)) {
                defaultOpts.signal = AbortSignal.timeout(Number(signalValue));
            } else {
                console.warn('Invalid signal or timeout value; using default signal.');
            }

            delete options[abortKey];
        }

        if (options.headers) {
            if ('object' === typeof options.headers && Object.keys(options.headers)?.length) {
                Object.assign(defaultOpts.headers, options.headers);
            }

            if (! hasCustomUpperLevelOptions) {
                delete options.headers;
            }
        }

        for (const [k, v] of Object.entries(options)) {
            if (fetchOptionKeys.includes(k.toLowerCase())) {
                defaultOpts[k] = v;
            } else {
                defaultOpts.headers[k] = v;
            }
        }

        const getResponseContent = async (responseObj, type = 'json', isClone = false) => {
            const clonedResponse = responseObj.clone();
            const tryResult = { status: 'success', data: {} };

            try {
                tryResult.data = await responseObj[type]();
            } catch (err) {
                tryResult.status = 'fail';
                tryResult.data = err;

                // Fallback to text if main format fails and we haven't cloned yet
                if (! isClone) {
                    const tryResultFromClone = await getResponseContent(clonedResponse, 'text', true);

                    return tryResultFromClone;
                }
            }

            return tryResult;
        };

        try {
            const response = await fetch(endpoint, ! hasCustomUpperLevelOptions ? defaultOpts : options);
            const contentHeader = response.headers.get('content-type') || 'application/json';
            const contentTypeMethodKeywords = {
                json: ['json'],
                text: ['text', 'html', 'css', 'javascript', 'xml'],
                formData: ['multipart', 'form'],
                blob: ['octet', 'image', 'audio', 'video', 'pdf', 'blob'],
                arrayBuffer: ['buffer']
            };
            const contentType = Object.keys(contentTypeMethodKeywords).find((k) => 
                contentTypeMethodKeywords[k].some((w) => 
                    contentHeader.toLowerCase().includes(w.toLowerCase())
                )
            ) || 'json';

            result.res = response;
            result.httpStatusCode = response.status;
            result.httpStatusText = response.statusText;
            result.headers = Object.fromEntries(response.headers.entries());

            if (! response.ok) {
                result.status = 'fail';
                result.ok = false;
            } else {
                result.ok = true;
            }

            const parsed = await getResponseContent(response, contentType);

            if (parsed.data?.data && 'object' == typeof parsed.data.data && Object.keys(parsed.data.data).length) {
                Object.assign(parsed.data, parsed.data.data);

                delete parsed.data.data;
            }

            if ('object' == typeof parsed.data && Object.keys(parsed.data)?.length) {
                Object.keys(parsed.data).forEach((k) => {
                    if (['info', 'success', 'warning', 'danger', 'accent'].includes(k)) { result.severity = k; }
                });
            }

            if ('fail' == parsed.status) { result.status = 'fail'; }
            
            result.data = parsed.data;
        } catch (err) {
            result.status = 'fail';
            result.httpStatusCode = err?.name === 'AbortError' ? 408 : 503;
            result.httpStatusText = err?.message || 'Service Unavailable';
            result.data = err;

            if (err?.stack) { result.stack = err.stack; }
            if (err?.name) { result.name = err.name; }
        }

        return result;
    };

    const loadImage = (params = {url: '', proxy: '', isBase64: false, crossOrigin: 'Anonymous', fnc: false}) => {
        params.proxy = ! params.proxy ? '' : (true === params.proxy ? 'https://cors-anywhere.herokuapp.com/' : params.proxy);

        return new Promise((resolve) => {
            let img = create('img', {crossOrigin: params.crossOrigin, src: params.proxy + params.url});
        
            img._on('load', (e) => {
                let thisElem = e.currentTarget;
        
                if (thisElem.complete) {
                    if (params.isBase64) {
                        let canvas = create('CANVAS', false, {className: 'soft-hide'});
                        data = '';
        
                        canvas.height = thisElem.height;
                        canvas.width = thisElem.width;
                        canvas.getContext('2d').drawImage(thisElem, 0, 0);
        
                        try {
                            data = canvas.toDataURL();
                        } catch (error) {
                            data = thisElem.src;
                        }
        
                        canvas = null;

                        if (! params.fnc) { return resolve(data); } else { params.fnc(data); }
                    }
                    
                    if (! params.fnc) { return resolve(thisElem); } else { params.fnc(thisElem); }
                }
                
                //OJO: No recuerdo porque devuelvo la URL aquí y tampoco se si esta línea llega a ejecutarse
                if (! params.fnc) { return resolve(params.url); } else { params.fnc(params.url); }
            });
            
            //OJO: No recuerdo porque devuelvo la URL aquí
            img._on('error', (e) => { if (! params.fnc) { resolve(params.url); } else { params.fnc(params.url); } });
        });
    }

    //Url de archivo, source de archivo, file de input file
    const loadFileContent = (file = '' || {}, mode = 'application/json', abortTime = false) => {
        return new Promise(async (resolve, reject) => {
            if ('string' == typeof file) {
                const params = {
                    cache: 'reload',
                    headers: {
                        'content-type': 'application/json'	
                    },
                    timeout: 60000
                };
        
                if (mode) { params.headers['content-type'] = mode; }
        
                if (abortTime) { params.timeout = abortTime; }
    
                const result = await runFetch(file, params);

                return resolve(result);
            }

            const modeKeywords = {
                readAsText: ['json', 'text', 'html', 'css', 'javascript', 'xml'],
                readAsDataURL: ['image', 'dataurl', 'base64'],
                readAsBinaryString: ['octet', 'audio', 'video', 'pdf', 'blob'],
                readAsArrayBuffer: ['buffer'],
            };
            const contentType = Object.keys(modeKeywords).find((k) => 
                modeKeywords[k].some((w) => 
                    mode.toLowerCase().includes(w.toLowerCase())
                )
            ) || 'readAsText';
            const reader = new FileReader();

            reader[contentType](file);
            reader.onload = (e) => { return resolve(e.target.result); }
            reader.onerror = (err) => {
                console.error('Error: ', err);

                return reject(err);
            }
        });
    }

    const setSessionGetToken = async () => {
        const token = await runFetch('./set-session-get-token', {cache: 'no-store', credentials: 'include'})?.data?.clientToken;

        if (token) {
            app.doc.dataset.clientToken = token;

            const ctMeta = select('[name="clientokent-token"]');

            if (ctMeta) { ctMeta.content = token; }

            return token;
        }

        return false;
    };

    /* Utilitarios para Scraping */
    //Query simple, no añade metodos a los resultados
    const q = (e, all = false) => ! all ? document.querySelector(e) : [...document.querySelectorAll(e)];

    const sleep = (t) => { return new Promise((resolve) => { setTimeout(() => { resolve(true); }, t); }); }

    const runIntervalUntil = (userFnc, every = 250, maxTime = 1000*60*10) => {
        let timeElapsed = 0;

        return new Promise((resolve) => {
            const fnc = async function() {
                if (timeElapsed >= maxTime) { return resolve(false); }

                let result = await userFnc();

                if (result != void 0 && result !== false && result !== null && result !== '') {
                    if ('object' == typeof result && ! Object.keys(result)?.length) { return false; }

                    return resolve(result);
                }

                setTimeout(() => {
                    timeElapsed += every;

                    fnc();
                }, every);
            }

            fnc();
        });
    }
    
    const typeWithExecCommand = async (elem, text, minDelay = 20, maxDelay = 50) => {
        text = text.toString();

        elem.focus();
        
        document.execCommand('selectAll', false, null);

        for (let l = 0; l < text.length; l++) {
            document.execCommand('insertText', false, text[l]);
            
            await sleep(randomNumber(minDelay, maxDelay));
        }

        return true;
    }

    const isIOS = () => { return /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase()); }
    const isElectron = () => { return window.navigator.userAgent.toLowerCase().indexOf('electron') + 1; }

    window._on = _on;
    window._removeOn = _removeOn;
    XMLHttpRequest.prototype._on = XMLHttpRequest.prototype.addEventListener;
    
    appendActions(app.doc);//Preparamos el doc

    window._on('popstate', (evt) => { app.popState(evt); });//Acción para el back button, lo que esté en cola se ejecutará

    /* Collección de funciones */
    [select, selectByContent, selectFocusable, removeElem, addClass, removeClass, hasClass, observeMutation, observeAttributes, dispatchEvent, isAttributeTrue, isAttributeFalse, containsString, softHide, onDomReady, create, createStyle, htmlToNode, cloneNode, isElement, isTextBox, strCleanUp, strStripTags, strReplace, generatePassword, generateID, pad, enableDisableToggle, disableForm, enableForm, disableElement, enableElement, getCookies, isFloat, roundToTwo, randomNumber, shuffle, arrayUnique, getTimestamp, getISO8601Timestamp, getLocalDate, getRelativeDate, getTimeDifference, getRamdomDateBetween, clearStorage, exportStorage, importStorage, runFetch, setSessionGetToken, loadImage, loadFileContent, q, sleep, runIntervalUntil, typeWithExecCommand, isIOS, isElectron, appendActions].forEach((n) => {
        window[objectName][n.name] = n;
    });

    onDomReady(() => {
        appendActions(document.body);//Preparamos el body

        if (select('dark-mode-toggler')) {
            const cs = app.get('colorScheme');

            //Si existe una preferencia dark en el storage o si no existe pero el usuario prefiere el tema dark, lo activamos
            if ((! cs && window.matchMedia('(prefers-color-scheme: dark)').matches) || 'dark' == cs) { app.doc._addClass('dark'); }

            /*
            app.doc._on('classchange', function(attrName, oldValue, newValue) {
                let ce = app.doc.$el;

                if (! app.doc._hasClass('dark')) {
                    for (const el in ce) { ce[el]._removeClass('dark'); }
                } else {
                    for (const el in ce) { ce[el]._addClass('dark'); }
                }
            }); */
        }

        let preloader = select('body > .preloader');
        if (preloader) { preloader._remove(); }
    });
})();