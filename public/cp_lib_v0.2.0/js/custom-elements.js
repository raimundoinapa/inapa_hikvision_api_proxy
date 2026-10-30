//Cuando los Custom Elements son creados desde Javascript, se debe hacer de la siguiente manera: const aForm = document.createElement('form', {is: 'super-form'});

(() => {
    "use strict;"
    
    const { app, appendActions, select, create, createStyle, selectFocusable, isTextBox, onDomReady, addClass, containsString, strCleanUp, generateID, disableForm, enableForm } = __CPLIB__;

    //A Tree - Funcionalidad básica, no incluye estilos, solo 3 niveles de profundidad
    /*
        Atributos
            dataset-type = 'dropdown-menu' | 'tabbed-panes' | 'tree' Propiedades que pueden ser utilizadas para darle estilo al arbol
            dataset-desktop_mode_at = '900px' Cambia aria-expanded a 'true' y deshabilita el toggler principal en la resolución espeficicada
            dataset.open_multiple = Nada ó 'true' Hace que los subtrees se cierren al abrir otro del mismo nivel
            dataset.is_contained = Nada ó 'true' Hace que el click afuera este limitado al contenedor
            dataset.no_dismiss = Nada ó 'true' //Solo para los botones o links que no sean toggler para que no cierren el menú
            aria-expanded = 'true' Establece el estado inicial del menú

        Si el primer elemento de un li que contiene un subtree es un botón, este se convertirá en el toggler
        Si el primer elemento de un li que contiene un subtree es un link, se añadirá un boton sibling que será el toggler

        Posibles errores lógicos:
            1 Cuando se esta en modo desktop, los elementos de los subtrees tiene el tabindex en -1, naturalmente pasan a 0
            cuando se abre el subtree, pero solo con click o enter, el hover nos da acceso al los botones estando en -1,
            sin embargo el -1 lo unico que hace es que nos quita el acceso via el teclado, el cual al usar enter o hacer click
            activa los botones
        OJO: Pensar en opción para mega menu

        Ejemplo:
            -------
    */
    class Tree extends HTMLUListElement {
        constructor() {
            super();

            appendActions(this);
        }

        connectedCallback() {
            if (this._isConnected) { return false; } else { this._isConnected = true; }

            //is="a-tree"
            //data-type="dropdown-menu"
            //data-type="tabbed-panes"
            //data-type="tree"
            //body[class^="A-TREE"] {}
            //dropdown-menu y tabbed-panes se pueden convertir en un accordion en versión móvil

            let ddm = this;

            if (! ddm.id) { ddm.id = generateID(); }//Generamos un ID que pueda ser usado en el push y pull del estado
            
            let classPrefix = ddm.dataset.type || 'tree';
            let bodyClass = `${classPrefix}_${ddm.id}-active`;
            let currentlyActiveElement = document.activeElement;
            let btns = ddm._select('a, button, a-button, a-hamburger, dark-mode-toggler');
            //let activeElements = selectFocusable(ddm, true);
            //let query = 'a[href], button, input, select, textarea, details, summary, embed, object, iframe, [tabindex], [contenteditable], [data-autofocus]';

            for (let b of btns) {
                let toggler = false;
                let subtree = b.nextElementSibling;

                if (subtree && /^(ul)|(div)$/.test(subtree?.tagName?.toLowerCase())) {
                    if (! b.id) { b.id = generateID(); }//Id para referenciar la descripción del subtree con aria-describedby
                    if (! subtree.id) { subtree.id = generateID(); }//Para ser usado en cambio de estado push o pull
                    if (! subtree.$el) { subtree.$el = {}; }

                    if (! b._hasClass('subtree-toggler')) {
                        toggler = create(
                            'a-button',
                            false,
                            {innerHTML: '<an-icon chevron-right></an-icon>', className: `subtree-toggler-arrow`}
                        );
                        
                        toggler.setAttribute('icon', true);
                        toggler.setAttribute('tabindex', -1);
                        toggler.setAttribute('aria-describedby', b.id);

                        b._insertAfter(toggler);
                    } else {
                        toggler = b;
                    }

                    sbm.$el.toggler = toggler;//Para ser usado con el evento onfocusout y la tecla Escape
                    
                    addClass(b.parentNode, `subtree-container`);
                    addClass(subtree, `subtree`);

                    b.setAttribute('aria-haspopup', true);

                    if (! b.hasAttribute('aria-expanded')) { b.ariaExpanded = false; }
                    if (! b.parentNode.hasAttribute('aria-expanded')) { b.parentNode.ariaExpanded = false; }
                    if (! subtree.hasAttribute('aria-expanded')) { b.ariaExpanded = false; }

                    if (! b.ariaExpanded) {  }
                    if (! b.parentNode.ariaExpanded) { b.parentNode.ariaExpanded = false; }
                    if (! subtree.ariaExpanded) { subtree.ariaExpanded = false; }

                    b._on('click', (e) => {
                        e.preventDefault();
                        //e.stopPropagation();
    
                        let thisToggler = e.currentTarget;
                        let childrenQuery = ['a', 'button', 'a-button', 'a-hamburger', 'dark-mode-toggler'].map(ce => `#${b.$el.subtree.id} > li > ${ce}`).join(', ');
                        let children = subtree._select(childrenQuery, true) || [];
                        
                        if (thisToggler.$el.subtree._isAttributeFalse('aria-expanded')) {
                            if (! subtree.dataset.hasOwnProperty('open_multiple')) { subtree._closeActiveSibligs(thisToggler); }//Autocerrar otros subtrees abiertos
                            
                            for (let b of children) { if (-1 === b.tabIndex || '-1' === b.tabIndex) { b.tabIndex = 0; } }

                            thisToggler._on('keyup', subtree._closeSubTree);

                            thisToggler.$el.subtree._on('keyup', subtree._closeSubTree);

                            app.pushState(thisToggler.$el.subtree.id, () => { subtree._closeSubTree(thisToggler.$el.subtree); });

                            thisToggler._addClass('open');
                            thisToggler.ariaExpanded = true;
                            thisToggler.parentNode.ariaExpanded = true;//Necesario en CSS para expanidir, OJO: se pudiera agregan una clase .open
                            thisToggler.$el.subtree.ariaExpanded = true;

                            return false;
                        }
    
                        for (let b of children) {
                            if (0 === b.tabIndex || '0' === b.tabIndex) {
                                if (! subtree.dataset.hasOwnProperty('open_multiple') && b._hasClass('open')) { b._event('click'); }
                                
                                b.tabIndex = -1;
                            }
                        }

                        thisToggler._removeOn('keyup', subtree._closeSubTree);
                        thisToggler.$el.subtree._removeOn('keyup', subtree._closeSubTree);
                        
                        app.pullState(thisToggler.$el.subtree.id);

                        thisToggler._removeClass('open');
                        thisToggler.ariaExpanded = false;
                        thisToggler.parentNode.ariaExpanded = false;
                        thisToggler.$el.subtree.ariaExpanded = false;
                    });
                }
            }

            for (let ae of activeElements) {
                let toggler = false;
                let sibling = ae.nextElementSibling;

                if (sibling && /^(ul)|(div)$/.test(sibling?.tagName?.toLowerCase())) {
                /*if (sibling && ('ul' == sibling?.tagName?.toLowerCase() || 'div' == sibling?.tagName?.toLowerCase())) {*/
                    if ('button' == ae.tagName.toLowerCase()) {
                        ae._addClass(`subtree-toggler`);

                        toggler = ae;
                    }

                    if ('a' == ae.tagName.toLowerCase()) {
                        if (! ae.id) { ae.id = generateID(); }//Id para referenciar la descripción del subtree con aria-describedby

                        toggler = create(
                            'a-button',
                            false,
                            {innerHTML: '<an-icon chevron-right>', className: `subtree-toggler-arrow`}
                        );
                        
                        toggler.setAttribute('icon', true);
                        toggler.setAttribute('tabindex', -1);
                        toggler.setAttribute('aria-describedby', ae.id);

                        ae._insertAfter(toggler);
                    }

                    if (toggler) { toggler.$el.subtree = sibling; }
                }
            }

            //Elegimos los elementos de nivel superior para la primara activación del menú
            let topLevelQuery = ['a', 'button', 'a-button', 'a-hamburger', 'dark-mode-toggler'].map(qe => `li ${qe}:not(li ul li ${qe})`).join(', ');
            ddm.$el.topLevelButtons = ddm._select(topLevelQuery, true);

            let allElements = selectFocusable(ddm, true);//Hacemos una segunda búsqueda por si se agregaron nuevos elementos (togglers)
            
            for (let ae of allElements) {
                let sbm = ae.$el.subtree;
                
                if (sbm) {
                    if (! sbm.id) { sbm.id = generateID(); }
                    if (! sbm.$el) { sbm.$el = {}; }

                    sbm.$el.toggler = ae;//Para ser usado con el evento onfocusout y la tecla Escape
                    
                    addClass(ae.parentNode, `subtree-container`);
                    addClass(sbm, `subtree`);

                    ae.setAttribute('aria-haspopup', true);
                    ae.ariaExpanded = false;
                    ae.parentNode.ariaExpanded = false;
                    sbm.ariaExpanded = false;

                    ae._on('click', (e) => {
                        e.preventDefault();
                        //e.stopPropagation();
    
                        let thisToggler = e.currentTarget;
                        let childrenQuery = ['a', 'button', 'a-button', 'a-hamburger', 'dark-mode-toggler'].map(ce => `#${ae.$el.subtree.id} > li > ${ce}`).join(', ');
                        let children = ddm._select(childrenQuery, true) || [];
                        
                        if (thisToggler.$el.subtree._isAttributeFalse('aria-expanded')) {
                            if (! ddm.dataset.hasOwnProperty('open_multiple')) { ddm._closeActiveSibligs(thisToggler); }//Autocerrar otros subtrees abiertos
                            
                            for (let b of children) { if (-1 === b.tabIndex || '-1' === b.tabIndex) { b.tabIndex = 0; } }

                            thisToggler._on('keyup', ddm._closeSubTree);

                            thisToggler.$el.subtree._on('keyup', ddm._closeSubTree);

                            app.pushState(thisToggler.$el.subtree.id, () => { ddm._closeSubTree(thisToggler.$el.subtree); });

                            thisToggler._addClass('open');
                            thisToggler.ariaExpanded = true;
                            thisToggler.parentNode.ariaExpanded = true;//Necesario en CSS para expanidir, OJO: se pudiera agregan una clase .open
                            thisToggler.$el.subtree.ariaExpanded = true;

                            return false;
                        }
    
                        for (let b of children) {
                            if (0 === b.tabIndex || '0' === b.tabIndex) {
                                if (! ddm.dataset.hasOwnProperty('open_multiple') && b._hasClass('open')) { b._event('click'); }
                                
                                b.tabIndex = -1;
                            }
                        }

                        thisToggler._removeOn('keyup', ddm._closeSubTree);
                        thisToggler.$el.subtree._removeOn('keyup', ddm._closeSubTree);
                        
                        app.pullState(thisToggler.$el.subtree.id);

                        thisToggler._removeClass('open');
                        thisToggler.ariaExpanded = false;
                        thisToggler.parentNode.ariaExpanded = false;
                        thisToggler.$el.subtree.ariaExpanded = false;
                    });
                }

                //Si no tiene subtree y el botón no previene el dismiss
                if (! sbm && ! ae.dataset.hasOwnProperty('no_dismiss')) {
                    ae._on('click', (e) => {
                        //Sin e.preventDefault, permitimos el scroll nativo o cualquier otra interacción
                        //e.stopPropagation();
    
                        ddm._dismiss();
                    });

                    /*
                        * Este bloque rebota el foco al toggler del menú o al menú mismo. Útil para cuando un componente externo devuelve
                        * el foco a un elemento del menú que se encuentra inacceible
                    */
                    ae._on('focus', (e) => {
                        let f = e.currentTarget;
                        
                        if (-1 === f.tabIndex || '-1' == f.tabIndex) {
                            if (ddm.$el.toggler && ddm.$el.toggler._isAttributeFalse('disabled')) {
                                ddm.$el.toggler.focus({preventScroll: true});

                                return false;
                            }

                            ddm.focus({preventScroll: true});
                        }
                    });
                }

                ae.tabIndex = -1;//En seguida quitamos el acceso al elemento
            }

            ddm._on('keydown', (e) => {
                if ('Escape' == e.key) {
                    e.preventDefault();
                    e.stopPropagation();

                    ddm._dismiss();
                }
            });

            ddm._on('attributechange', (attrName, oldValue, newValue) => {
                if ('aria-expanded' != attrName) { return false; }

                if (! oldValue || 'false' == oldValue) {
                    currentlyActiveElement = document.activeElement;
                    
                    if (! ddm.dataset.hasOwnProperty('is_contained')) { document.body._addClass(bodyClass); }

                    for (let tlb of ddm.$el.topLevelButtons) { tlb.tabIndex = 0; }
                    
                    ddm.tabIndex = 0;
                    ddm.focus({preventScroll: true});
                    
                    ddm._on('focusout', ddm._onBlur);

                    app.pushState(ddm.id, ddm._dismiss);

                    return false;
                }

                app.pullState(ddm.id);

                ddm._removeOn('focusout', ddm._onBlur);
                
                ddm._closeActiveSibligs();

                for (let tlb of ddm.$el.topLevelButtons) { tlb.tabIndex = -1; }

                ddm.tabIndex = -1;

                if (! ddm.dataset.hasOwnProperty('is_contained')) { document.body._removeClass(bodyClass); }        

                if (ddm.$el.toggler) {
                    ddm.$el.toggler.ariaPressed = false;

                    if (ddm.$el.toggler?.$el?.button) { ddm.$el.toggler.$el.button.ariaPressed = false; }
                }

                if (currentlyActiveElement) { currentlyActiveElement.focus({preventScroll: true}); }
            });

            ddm._closeSubTree = (e) => {
                let thisSubTree = {};
                
                if (! e.key) {
                    thisSubTree = e;
                } else {
                    if ('Escape' != e.key) { return false; }

                    e.preventDefault();
                    e.stopPropagation();

                    thisSubTree = e.currentTarget;

                    if (thisSubTree.$el.subtree) { thisSubTree = thisSubTree.$el.subtree; }
                }
                
                if (thisSubTree._isAttributeTrue('aria-expanded')) {
                    thisSubTree.$el.toggler.focus({preventScroll: true});
                    thisSubTree.$el.toggler._event('click');
                }
            }

            ddm._closeActiveSibligs = (toggler = false) => {
                let ol = 'li[aria-expanded="true"]';
                let topLevelTogglers = ddm._select(`${ol} > .open:not(${ol} ${ol} > .open)`, true);
                let secondLevelTogglers = ddm._select(`${ol} ${ol} > .open`, true);

                for (const s of secondLevelTogglers) { if (! toggler || toggler != s) { s._event('click'); } }

                for (const t of topLevelTogglers) {
                    if (! toggler || ! t.parentNode.contains(toggler)) { t._event('click'); }
                }
            }

            ddm._onBlur = (e) => {
                if (! e.currentTarget.contains(e.relatedTarget)) {
                    //El click se hizo sobre el toggler, este se debe encargar de desactivar el menú
                    if (ddm?.$el?.toggler == e.relatedTarget) { return false; }
                    
                    ddm._dismiss();
                }
            };

            ddm._dismiss = () => {
                if (ddm.dataset.hasOwnProperty('desk_top_mode')) { return false; }

                ddm.ariaExpanded = false;
            }

            ddm._dismissSubTreeDesktopMode = (e) => {
                if (! e.currentTarget.contains(e.relatedTarget)) { ddm._closeActiveSibligs(); }
            }

            if (ddm.dataset.desktop_mode_at) {
                let mediaCheck = window.matchMedia(`(min-width: ${ddm.dataset.desktop_mode_at})`);

                mediaCheck.addEventListener('change', (e) => {
                    if (! mediaCheck.matches) {
                        delete ddm.dataset?.desk_top_mode;

                        if (ddm.$el.toggler) { ddm.$el.toggler.disabled = false; }

                        for (let tlb of ddm.$el.topLevelButtons) { tlb.tabIndex = -1; }
                        
                        /* ddm._closeActiveSibligs();
                        ddm.tabIndex = -1;
                        ddm.ariaExpanded = false; */

                        ddm._removeOn('focusout', ddm._dismissSubTreeDesktopMode);
                    } else {
                        ddm.dataset.desk_top_mode = true;

                        if (ddm.$el.toggler) { ddm.$el.toggler.disabled = true; }
        
                        for (let tlb of ddm.$el.topLevelButtons) { tlb.tabIndex = 0; }

                        /* ddm.tabIndex = 0; */
                        ddm.ariaExpanded = true;
                        ddm.focus({preventScroll: true});

                        //OJO: Ver si esto afecta el focusout del modo mobil, o si se acumulan los eventos
                        ddm._on('focusout', ddm._dismissSubTreeDesktopMode);
                    }
                });

                mediaCheck.dispatchEvent(new Event('change'));//Forzamos el primer checkeo
            }
        }
    }//No se puede usar clases anónimas para extender elementos que nos sean HTMLElement
    customElements.define('a-tree', Tree, {extends: 'ul'});

    /*
     * Super Form - Validación e interacción básica de formularios
     * 
     * 
     * Atributos
     *      id                                  //Se toma en cuenta para enviarlo en el dataForm, no es obligatorio
     *      dataset.fetch_timeout               //Le pone un timeout al fetch, si no se establece, el fetch tendrá un timeout de 10000
     * 
     *      Para Elementos
     *          elem.dataset.no_clear_button    //Nada o true, indica que el clearButton no se debe agregar al input
     *          elem.dataset.error_message      //Mensaje de error personalizado
     *          elem.dataset.prevent_scroll     //Nada o true, si hay un error y se va a hacer el foco, previene el scroll,
     *                                            útil para cuando el elemento ya esta visible y no se quiere mover el viewport
     *          elem.dataset.active_validation  //Nada o true, valida positivo y negativo oninput u onkeyup (No implementado)
     *          elem.dataset.reveal             //Nada o true, para input type password. Activa el ojito para visualizar la contraseña
     *
     * 
     * Propiedades y Métodos accesibles desde afuera
     *      frm.$el.submitButton
     *      frm.$el.resetButton
     *      frm._fnc
     *      frm._onBeforeSubmit
     *      frm._onsubmit                       //Se ejecuta una vez se reunen los datos y se le pasan los parámetros frm, frmData
     * 
     * Reglas de validación
     *   Se validará usando el objeto elem.validity para simplificar la validación y la aplicación de estilos
     *   La validación será pasiva y solo a elementos que tenga valor, así sean requeridos o no
     *   La validación activa se hará onsumbit para todos los elementos
     *   Los elementos con error se les pondrá la clase .invalid
     *   Los elementos no requeridos y sin valor reportan elem.validity.valid = true, y como CSS no puede determinar si un elemento
     *   tiene valor o no, nos guiamos de :placeholder-shown, con la excepción de los select box
     *   Para los select box aplicamos la clase .valid cuando son válidos para tener mejor contron de los estilos
    */
    class SuperForm extends HTMLFormElement {
        constructor() {
            super();

            appendActions(this);
        }

        connectedCallback() {
            if (this._isConnected) { return false; } else { this._isConnected = true; }

            let frm = this;

            onDomReady(() => {
                frm.noValidate = 'novalidate';//Para que no se usen los mensajes de error nativos

                let submitButton = frm._select('[type="submit"]'),
                resetButton = frm._select('[type="reset"]'),
                loadingBox = create('div', false, {className: 'preloader'}),
                isValid = (elem, activeValidation = false) => {
                    //OJO: elem.checkValidity()//Otra forma de verificar
                    //So valor es válido o si no tiene valor, pero la validación no es agresiva (argumento activeValidation) devolvemos true
                    if (elem.validity.valid || (elem.validity.valueMissing && ! activeValidation)) { return true; }                    

                    return false;
                },
                showError = (elem) => {
                    const altTerm = elem.required && elem.validity.valueMissing ? ' requerido' : ' inválido';

                    elem.$el.msgHolder.textContent = ! elem.dataset.error_message ? (! elem.$el.label ? 'Campo' : elem.$el.label.textContent) + altTerm : elem.dataset.error_message;

                    elem._addClass('invalid');

                    //Para los select usamos la clase valid, eso pudiera dar un resultado valid invalid, asi que removemos valid
                    if ('select' == elem.tagName.toLowerCase() || elem.list) { elem._removeClass('valid'); }
                },
                hideError = (elem) => {
                    if (elem.$el.msgHolder) { elem.$el.msgHolder.textContent = ''; }

                    elem._removeClass('invalid');
                },
                selectFirstError = () => {
                    const firstElemWithError = frm._select('.invalid');

                    if (firstElemWithError) {
                        const preventScroll = ! firstElemWithError.dataset.hasOwnProperty('prevent_scroll') ? {} : {preventScroll: true};

                        if (! preventScroll) { firstElemWithError.scrollIntoView({block: 'center', behavior: 'smooth'}); }

                        firstElemWithError.focus(preventScroll);

                        if(isTextBox(firstElemWithError)) { firstElemWithError.select(); }
                    }
                };
                
                //OJO: Esta función no esta en uso, pero pudiera ser útil, inclusive se puediera pasar al helper directamente
                const abortSignal = (t) => {
                    const controller = new AbortController();

                    //Para detener el timeout, se puede hacer clearTimeout(controller.signal._timeout)
                    controller.signal._timeout = setTimeout(() => controller.abort(), t);

                    return controller.signal;
                };

                if (submitButton) {
                    frm.$el.submitButton = submitButton;

                    if ('A-BUTTON' == submitButton.tagName.toUpperCase()) {
                        submitButton._on('click', (e) => {
                            e.preventDefault();
                            
                            /* frm.dispatchEvent(new Event('submit', {
                                'view' : window,
                                'bubbles' : true,
                                'cancelable': true
                            }));

                            console.log(frm);

                            return false;

                            console.log(frm);
                            frm.dispatchEvent('submit'); */
                            frm._event('submit');
                        });
                    }
                }
                if (resetButton) { frm.$el.resetButton = resetButton; }

                for (let e of frm.elements) {
                    if (! e.name || e == submitButton || e == resetButton || 'button' == e?.type?.toLowerCase() || 'hidden' == e?.type?.toLowerCase()) { continue; }
                    
                    appendActions(e);

                    if (e.labels && e.labels[0]) {
                        e.$el.label = e.labels[0];
                    } else {
                        const labelFix = frm._select(`label[for="${e.name}"]`);//No tiene relación por id, pero si por nombre

                        if (labelFix) {
                            if (! e.id) { e.id = generateID(); }
                            
                            labelFix.htmlFor = e.id;

                            e.$el.label = labelFix;
                        }
                    }

                    //Si tiene label pero le falta el aria-label, se lo agregamos
                    if (e.$el.label && ! e.getAttribute('aria-labeledby') && ! e.getAttribute('aria-label')) { e.setAttribute('aria-label', e.$el.label.textContent); }

                    //Checkeo de elementos de múltiple que crean [] en el post o get
                    if (e.name.indexOf('[]') < 0 && 'checkbox' == e?.type?.toLowerCase()) {
                        const cbMultiple = frm._select(`[name="${e.name}"]`, true);
        
                        if (cbMultiple.length > 1) { for (let cbm of cbMultiple) { cbm.name += '[]'; } }
                    }

                    if (e.name.indexOf('[]') < 0 && (e.getAttribute('multiple') || 'select-multiple' == e?.type?.toLowerCase())) { e.name += '[]'; }
                    
                    e.$el.msgHolder = create('div', false, {className: 'error-message'});
                    e.parentNode.appendChild(e.$el.msgHolder);

                    //OJO: Ocultamos el div de mensaje de error para los radio y checkbox, ver si es factible no ocultarlos y como ajustar la presentación del mensaje de error
                    if ('radio' == e?.type?.toLowerCase() || 'checkbox' == e?.type?.toLowerCase()) { e.$el.msgHolder._addClass('soft-hide'); }

                    e._on('blur', (evt) => {
                        const elem = evt.currentTarget;

                        if (! isValid(elem)) { showError(elem); }

                        //Si se muestran los errores onsubmit, estos incluyen los campos vacíos, así que aquí los oculatamos onblur
                        if (! elem.value) { hideError(elem); }
                        
                        if (elem.$el.clearButton) { elem.$el.clearButton._remove(); }
                        if (elem.$el._revealPasswordButton) { elem.$el._revealPasswordButton._remove(); }
                    });
                    
                    if (! isTextBox(e)) {
                        if ('radio' != e.type.toLowerCase() && 'checkbox' != e.type.toLowerCase()) {
                            //La clase valid es solo para los select e inputs de selección, para los demas controlnes usamos la seudo clase :valid
                            if (e.value) { e._addClass('valid'); }
                                
                            e._on('change', (evt) => {
                                const elem = evt.currentTarget;

                                elem._removeClass('valid');
                                elem._removeClass('invalid');

                                if (elem.value) {
                                    hideError(elem);

                                    elem._addClass('valid');
                                }
                            });
                        } else {
                            e._on('change', (evt) => {
                                const elem = evt.currentTarget;

                                if (elem.checked) { hideError(elem); }
                            });
                        }
                    } else {
                        //OJO: Posible patrón para validación de Email ^[^\s]+@[^\s]+\.\w{2,5}(\.\w{2})?$

                        if ('search' != e?.type?.toLowerCase() && 'textarea' != e.tagName?.toLowerCase()) {
                            if (! e?.dataset?.hasOwnProperty('no_clear_button')) {
                                e.$el.clearButton = create('a-button', {tabIndex: -1, circle: 'true', icon: 'true'}, {innerHTML: `
                                    <style> :host { --with-icon-size: 1.2em; }</style>
                                    <an-icon x size="9px"></an-icon>
                                `, style: {position: 'absolute', top: 'calc(50% - 10px)', right: '5px'}});

                                e.$el.clearButton.$el.input = e;
                                
                                e.$el.clearButton._on('mousedown', function(evt) {
                                    evt.preventDefault();

                                    const elem = evt.currentTarget;

                                    elem.$el.input.focus();
                                    elem.$el.input.value = '';
                                    elem.$el.input._event('input');

                                    hideError(elem.$el.input);

                                    elem._remove();

                                    if (elem.$el.input.$el._revealPasswordButton) { elem.$el.input.$el._revealPasswordButton._remove(); }
                                });
                            }
                        }

                        if ('password' == e?.type?.toLowerCase() || 'password' == e?.dataset?.type) {
                            if (! e.pattern) {
                                e.pattern = "^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&'`*.,;:_~+=<>?\\-\\[\\]\\|\\(\\)\\{\\}\\/\\\\\"]).{8,32}$";
                                //Se convierte en: ^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&'`*.,;:_~+=<>?\-\[\]\|\(\)\{\}\/\\&quot;]).{8,32}$
                            }

                            if (! e._revealPasswordButton && e?.dataset?.reveal) {
                                e.dataset.type = 'password';

                                e.$el._revealPasswordButton = create('a-button', {tabIndex: -1, circle: 'true', icon: 'true'}, {innerHTML: `
                                    <style> :host { --with-icon-size: 1.2em; }</style><an-icon eye-open size="14px" data-bind="icon"></an-icon>
                                `, style: {position: 'absolute', top: 'calc(50% - 10px)', right: '30px'}});

                                e.$el._revealPasswordButton.$el.input = e;

                                e.$el._revealPasswordButton._on('mousedown', function(evt) {
                                    evt.preventDefault();
        
                                    const elem = evt.currentTarget;

                                    if ('text' != elem.$el.input.type) {
                                        elem.$el.input.type = 'text';

                                        elem.$el.icon.remAttr = 'eye-open';
                                        elem.$el.icon.setAttr = {'eye-closed': true};
                                    } else {
                                        elem.$el.input.type = 'password';

                                        elem.$el.icon.remAttr = 'eye-closed'
                                        elem.$el.icon.setAttr = {'eye-open': true};
                                    }

                                    elem.$el.input.focus();
                                });
                            }
                        }

                        if ('tel' == e?.type?.toLowerCase()) { e.pattern = '^\\+?\\d{9,15}$'; }

                        e._on('focus', (evt) => {
                            const elem = evt.currentTarget;

                            if (elem.$el.clearButton) {
                                elem.$el.clearButton.toggleAttribute('disabled', false);
                                elem.$el.clearButton.toggleAttribute('aria-disabled', false);
                                elem.$el.clearButton.toggleAttribute('readonly', false);

                                if (elem.value) {
                                    elem.parentNode.appendChild(elem.$el.clearButton);
                                }  
                            }

                            if (elem.$el._revealPasswordButton) {
                                elem.$el._revealPasswordButton.toggleAttribute('disabled', false);
                                elem.$el._revealPasswordButton.toggleAttribute('aria-disabled', false);
                                elem.$el._revealPasswordButton.toggleAttribute('readonly', false);

                                if (elem.value) {
                                    elem.parentNode.appendChild(elem.$el._revealPasswordButton);
                                }
                            }
                        });

                        e._on('keydown', (evt) => {
                            const elem = evt.currentTarget;

                            if (isValid(elem) || ! elem.value) { hideError(elem); }
        
                            if (! elem.value) {
                                if (elem.$el.clearButton) { elem.$el.clearButton._remove(); }
                                if (elem.$el._revealPasswordButton) { elem.$el._revealPasswordButton._remove(); }
                            } else {
                                if (elem.$el.clearButton) { elem.parentNode.appendChild(elem.$el.clearButton); }
                                if (elem.$el._revealPasswordButton) { elem.parentNode.appendChild(elem.$el._revealPasswordButton); }
                            }

                            //Cualquier input de texto diferente a un textarea debería enviar el formulario al presionar Enter
                            if ('Enter' == evt.key && 'textarea' != e.tagName.toLowerCase()) {
                                
                                frm._event('submit');
        
                                return false;
                            }
                        });
                    }
                }

                if (resetButton) {
                    resetButton._on('click', (evt) => {
                        evt.preventDefault();

                        for (let e = 0; e < frm.elements.length; e++) {
                            const elem = frm.elements[e];

                            if (elem._removeClass) { elem._removeClass('invalid'); }
                        }

                        const rstBtn = create('button', {type: 'reset'}, {innerHTML: 'Reset', style: {position: 'absolute', visibility: 'hidden', display: 'none'}});

                        frm.appendChild(rstBtn);
                        
                        rstBtn.click();
                        rstBtn._remove();
                    });
                }

                frm._on('submit', async (evt) => {
                    evt.preventDefault();

                    if (frm._onBeforeSubmit) { frm._onBeforeSubmit(frm); }

                    let isMultipartFormData = false;
                    let formError = false;

                    const ctMeta = select('[name="client-token"]');
                    const frmData = new FormData();

                    for (let e of frm.elements) {
                        if (! e.name) { continue; }

                        /*
                        * Si el usuario visializa el password y olvida ocultarlo, le cambiamos el tipo para que la validación
                        * se haga correctamente (Aunque creo que no afecta y adicionalmente debería usar un patrón para la validación)
                        */
                        if ('password' == e?.dataset?.type) { e.type = 'password'; }

                        if (! isValid(e, true)) {
                            showError(e);
                            
                            formError = true;
                            
                            continue;
                        }
            
                        if ('radio' == e?.type.toLowerCase() || 'checkbox' == e?.type.toLowerCase()) {
                            if (e.checked) { frmData.append(e.name, e.value || e.checked); }
            
                            continue;
                        }
            
                        //Existen select [type="select-one"] y [type="select-multiple"]
                        let isMultiple = e.getAttribute('multiple') || 'select-multiple' == e?.type?.toLowerCase() || e.name.indexOf('[]') + 1;
            
                        if ('select' == e?.tagName?.toLowerCase()) {
                            if (isMultiple) {
                                for (let eso of e.selectedOptions) { frmData.append(e.name, eso.value); }
                            } else {
                                frmData.append(e.name, e.value);
                                //frmData.append(e.name, e.options[e.selectedIndex].value);//Forma vieja
                            }
            
                            continue;
                        }
            
                        if ('file' == e?.type?.toLowerCase() && e?.files?.length) {
                            let accept = e.accept;
                            
                            if (accept) {
                                if (accept.indexOf(',') + 1) {
                                    accept = accept.split(',').map((a) => {
                                        a =  strCleanUp(a);
                
                                        return a.replace('.', '');
                                    });
                                }
                            }

                            //Si contiene mas de un archivo y el nombre no es para un array , lo arreglamos
                            if (e.files.length > 1 && e.name.indexOf('[]') < 0) { e.name += '[]'; }

                            //OJO: Solamente añadimos los archivos válidos al frmData omitiendo el resto, sin presentar ningun error,
                            //analizar que se puede hacer para presentar un mensaje de error
                            for (let f of e.files) {
                                if (accept) {
                                    if ('string' != typeof accept) {
                                        for (let a of accept) {
                                            if (containsString(f.type, a)) {
                                                frmData.append(e.name, f, f.name);

                                                break;
                                            }
                                        }
                                    } else {
                                        if (containsString(f.type, accept)) { frmData.append(e.name, f, f.name); }
                                    }
                                }
                            }
            
                            isMultipartFormData = true;
            
                            continue;
                        }
            
                        frmData.append(e.name, e.value);
                    }

                    if (formError) {
                        selectFirstError();

                        return false;
                    }
            
                    disableForm(frm);
                    
                    submitButton.$el.loadingBox = loadingBox;
                    
                    if ('input' == submitButton.tagName.toLowerCase()) {
                        submitButton._insertAfter(loadingBox);
                    } else {
                        submitButton.appendChild(loadingBox);
                    }
                    
                    frmData.append('clientToken', ctMeta?.content || document.documentElement?.dataset?.clientToken || '');
                    frmData.append('frmId', frm.id || '');

                    if (frm._onsubmit) {
                        frm._onsubmit(evt, frm, frmData);

                        return false;
                    }

                    let submitResponse = {};
                    let submitResponseClone = {};
                    let response = {};

                    if (! isMultipartFormData) {
                        const headers = new Headers({
                            'cache': 'reload',
                            'cp-api-key': 'CPLibApiKey',
                        });

                        //application/x-www-form-urlencoded
                        headers.append('Content-Type', frm.enctype || 'application/json');

                        try {
                            //Enviamos el formulario
                            submitResponse = await fetch(frm.action, {
                                method: frm.method.toUpperCase(),
                                headers: headers,
                                body: new URLSearchParams(frmData),
                                signal: AbortSignal.timeout(frm?.dataset?.fetch_timeout || 10000),
                            });

                            /*
                            body: (...)
                            bodyUsed: true          Supongo que es si .json() o .text() fue ejecutado
                            ok: true                es el equivalente a status == 200 a 299 cuando es true, cuando es false, es cualquier código fuera del rango 200-299
                            redirected: false
                            status: 200             200-299, 300, 401, 403, 404, 500
                            statusText: "OK"
                            type: "basic"           basic | cors | opaque
                            url: "https://xxx"
                            headers: Headers {}     .entries(), .keys(), .values()
                                                    ['connection', 'keep-alive']['content-type', 'text/html; charset=UTF-8']
                                                    ['date', 'Thu, 05 May 2022 01:53:12 GMT']['expires', 'Thu, 19 Nov 1981 08:52:00 GMT']
                                                    ['pragma', 'no-cache']['server', 'nginx/1.17.5']['transfer-encoding', 'chunked']
                                                    ['x-powered-by', 'PHP/7.4.20']
                            */

                            //Se clona la respuesta para enviarlo a alguna función personalizada junto con la respuesta en json o text
                            submitResponseClone = submitResponse.clone();

                            const contentHeader = submitResponse.headers.get('content-type') || '';
                            const contentTypeMethods = {json: 'json', text: 'text', html: 'text', css: 'text', javascript: 'text', xml: 'text', 'octet-stream': 'blob', image: 'blob', audio: 'blob', video: 'blob', pdf: 'blob', multipart: 'formData', 'form-data': 'formData'};
                            const contentType = contentTypeMethods[Object.keys(contentTypeMethods).filter(m => contentHeader.indexOf(m) + 1)[0]];

                            if (! contentType) {
                                try {
                                    const responseTemp = JSON.parse(response);

                                    response = responseTemp;
                                } catch (e) {
                                    console.error('Error: ', e);
                                } finally {
                                    //OJO: No hacemos nada, solo nos interesa que el script continue, pero no estoy seguro si funciona
                                }
                            } else {
                                response = await submitResponse[contentTypeMethods[contentType]]();    
                            }
                        } catch (err) {
                            console.error('Error: ', err);
                        }
                    } else {
                        await new Promise((resolve) => {
                            const xhr = new XMLHttpRequest();

                            xhr._on = xhr.addEventListener;
        
                            xhr._on("progress", (e) => {
                                if (e.lengthComputable) { console.info("upload/download progress:", e.loaded / e.total); }
                            });
                            
                            xhr._on("loadend", (e) => {
                                if (xhr.readyState === 4 && xhr.status === 200) { console.info("The transfer is complete.", e); }
                            });
    
                            xhr._on("error", (event) => {
                                console.info("An error occurred while transferring the file.", e);
                            });
    
                            xhr._on("abort", (e) => {
                                console.info("The transfer has been canceled by the user.", e);
                            });
    
                            xhr.open(frm.method, frm.action);//xhr.open('POST' || 'PUT', thisElem.action);
                            xhr.setRequestHeader("cp-api-key", "CPLibApiKey");//OJO: Ver nota del fetch
                            xhr.setRequestHeader('pragma', 'no-cache');
                            xhr.setRequestHeader('Cache-Control', 'no-cache, no-store, must-revalidate');//OJO: Me imagino que esta línea mas la anterior es el equivalente a cache: 'reload' para fetch
                            xhr.setRequestHeader('Access-Control-Allow-Origin', '*');//OJO: Me imagino que esto es el equivalente a mode: 'cors' para fetch
                            xhr.setRequestHeader('Content-Type', frm.enctype || 'multipart/form-data; charset=UTF-8');
                            //frmData.append('Math.random(), Math.random());//Para evitar resultados cacheados
                            xhr.send(frmData);

                            xhr.onreadystatechange = function() {
                                if (xhr.readyState == 4) {
                                    submitResponse.status = xhr.status;//Simulamos un resultado de un fetch
                                    submitResponseClone = xhr;
    
                                    submitResponse.ok = xhr.status > 199 && xhr.status < 300;
                                    
                                    try {
                                        response = JSON.parse(xhr.responseText);

                                        return resolve(true);
                                    } catch (e) {
                                        console.error('Error: ', e);
                                    } finally {
                                        response = xhr.responseText;

                                        return resolve(false);
                                    }
                                }
                            }
                        });
                    }

                    loadingBox._remove();

                    //Basado en https://github.com/omniti-labs/jsend
                    //response = {
                        //httpStatusCode: 400,
                        //status: 'success' | 'fail' | 'error',
                        //severity: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent',
                        //message: 'User not found',
                        //formErrors: {elem: '', elem2: ''},
                        //redirect: '',
                        //data : [{"post" : { "id" : 1, "title" : "A blog post", "body" : "Some useful content" }}],
                        //clone: {}//Clón de la respuesta del fetch
                    //}

                    const severity = response?.severity || response?.info || response?.success || response?.warning || response?.danger || response?.accent;

                    //submitResponse.status no esta en el rango 200-299)
                    if (! submitResponse.ok) {
                        enableForm(frm);

                        if (response?.formErrors) {
                            for (let elemError in response.formErrors) {
                                frm[elemError]._addClass('invalid');
                                frm[elemError].$el.msgHolder.textContent = response.formErrors[elemError];
                            }

                            selectFirstError();
                        } else {
                            if (response?.message) {
                                const dialogOptions = {'close-button': '', 'self-destroy': '', body: response.message, state: 'active'};

                                dialogOptions[severity || 'neutral'] = '';

                                const errorDialog = create('a-dialog', dialogOptions);
                                
                                if (response?.redirect) {
                                    errorDialog._onClose = () => { window.location.assign(response.redirect); }
                                }
                                
                                document.body.appendChild(errorDialog);
                            }
                        }
                    } else {
                        if (response?.redirect) {
                            window.location.assign(response.redirect);
                        } else {
                            enableForm(frm);
                        }
                    }

                    if (frm._fnc) { frm._fnc(frm, response, submitResponseClone); }
                });
            });
        }
    }
    customElements.define('super-form', SuperForm, {extends: 'form'});

    /*
    Captcha
    OJO: A este componente le faltan los elementos aria, especialmente para el audio
    Atributos
        dataset.captcha_name
        dataset.source_url
        dataset.label
        dataset.required
    */
    class captchaComponent extends HTMLDivElement {
        constructor() {
            super();

            appendActions(this);
        }

        connectedCallback() {
            if (this._isConnected) { return false; } else { this._isConnected = true; }

            let captchaName = this.dataset.captcha_name || 'captcha';
            let sourceUrl = this.dataset.source_url || '/captcha';
            let label = this.dataset.label || 'Captcha';
            //let required = ! (! this.dataset.required || 'false' == this.dataset.required);
            let required = this.dataset.hasOwnProperty('required');

            const _self = this;
            
            _self.innerHTML = /*html*/`
                <style>
                    #${captchaName} { width: 6rem; }
                    .captcha-image {
                        height: 100%;
                        border: 1px solid var(--border-color);
                        border-radius: var(--border-radius-1);
                        margin-left: 7px;
                    }
                    .captcha-audio {
                        position: absolute;
                        width: 0;
                        height: 0;
                    }
                    .refresh-captcha-button,
                    .play-audio-button {
                        height: 100%;
                        width: 45px;
                        padding: 0;
                    }
                    .captcha-btns-container { gap: 7px; }
                </style>
                <div class="p-relative">
                    <input type="text" name="${captchaName}" id="${captchaName}" placeholder="${label}" autocomplete="off" pattern="[a-zA-Z0-9]{6}" ${required}>
                    <label for="${captchaName}" class="label-placeholder">${label}</label>
                </div>
                <div class="d-flex-center captcha-btns-container">
                    <img src="" alt="" class="captcha-image">
                    <audio class="captcha-audio" controls="controls" src="" tabindex="-1"></audio>
                    <button type="button" class="play-audio-button button-primary" aria-label="Captcha Audio Play">ᐅ</button>
                    <button type="button" class="refresh-captcha-button button-primary">⭮</button>
                </div>
            `;

            let input = _self._select(`#${captchaName}`);
            let img = _self._select('.captcha-image');
            let audio = _self._select('.captcha-audio');
            let playButton = _self._select('.play-audio-button');
            let refreshButton = _self._select('.refresh-captcha-button');

            if (required) { input.required = true; }

            playButton._playIcon = playButton.textContent;
            playButton._pauseIcon = '||';

            refreshButton._on('click', (e) => {
                e.preventDefault();

                fetchMedia();
            });
            
            playButton._on('click', (e) => {
                e.preventDefault();

                if (audio.paused || audio.currentTime < 0 && ! audio.ended) {
                    audio.play();

                    playButton.ariaPressed = true;
                    playButton.textContent = playButton._pauseIcon;
                }
                
                audio.onended = function() {
                    playButton.ariaPressed = false;
                    playButton.textContent = playButton._playIcon;
                };

                return false;
            });

            const fetchMedia = async () => {
                const ctMeta = select('[name="client-token"]');

                const frmData = new FormData();
                frmData.append('clientToken', ctMeta?.content || document.documentElement.dataset.clientToken || '');
                frmData.append('captchaName', captchaName);

                try {
                    let media = await fetch(sourceUrl, {method: 'POST', body: frmData, cache: 'reload'});

                    if (media.ok) {
                        let json = await media.json();
                        
                        if (json) {
                            if (json?.responseText?.image) { img.src = json.responseText.image; }
    
                            if (json?.responseText?.audio) { audio.src = json.responseText.audio; }
                        }
                    }
                } catch (error) {
                    console.error('Error:', err);
                }
            }

            fetchMedia();
        }
    }
    customElements.define('a-component', captchaComponent, {extends: 'div'});

    /*
     * Todos los atributos del a-dialog se pueden pasar al modal-link y dialog-button por data con el prefijo modal_
     * ej.: data-modal_url, data-modal_load-url, data-modal_scroll-on-wrapper
    */
    const dialogTrigger = (elem) => {
        elem.style.position = 'relative;';

        if (! elem.getAttribute('aria-controls')) {
            const url = elem.dataset['modal_url'] ||  elem.dataset['modal_load-url'] || elem.dataset['modal_load-url-onopen'] || elem.href;

            if (url) {
                const aModal = create('a-dialog');
                const attrList = aModal._attrList;
                
                if (! elem.href) {
                    if ('modal-link' == elem.getAttribute('is')) { elem.href = 'javascript:void(0);';}
                } else {
                    aModal.setAttr = {'url': url};//La url no viene ni por modal_url ni modal_load-url ni modal_load-url-onopen
                }

                for (const a of attrList) {
                    if (elem.hasAttribute('data-modal_' + a)) {
                        aModal.setAttribute(a, elem.dataset['modal_' + a]);

                        delete elem.dataset['modal_' + a];
                    }        
                }

                document.body.appendChild(aModal);

                elem.setAttribute('aria-controls', aModal.id);//El id se genera connectedCallback
            }
        }

        //Wave Effect
        elem._on('mousedown', (e) => {
            //e.preventDefault();//No se si es necesario
            
            let elementYX = elem.getBoundingClientRect();

            let top = Math.round(e.pageY - elementYX.y - window.scrollY) + 'px';
            let left = Math.round(e.pageX - elementYX.x - window.scrollX) + 'px';

            const div = create('div', false, {className: 'true-abs-pos wave-effect', style: {
                top: top,
                left: left
            }});

            elem.appendChild(div);
            
            div._on('animationend', () => { try { div._remove(); } catch(c) {} });
            
            /* Por si animationend no le da chance a accionar debido a que el botón o link fue ocultado */
            setTimeout(() => { try { div._remove(); } catch(c) {} }, 500);
        });

        elem._on('click', (e) => {
            e.preventDefault();         

            if (! elem.$el.target) {
                let query = '#' + (elem.getAttribute('aria-controls') || '');

                elem.$el.target = select(query) || elem.getRootNode()?._select(query);
    
                if (! elem.$el.target) { return false; }
    
                elem.$el.target.$el.toggler = elem;
            }

            elem.$el.target.setAttr = {state: 'active'};//Sólamente activa el modal, no lo desactiva
        });
    }
    class DialogLink extends HTMLAnchorElement {
        constructor() {
            super();

            appendActions(this);
        }

        connectedCallback() {
            if (this._isConnected) { return false; } else { this._isConnected = true; }

            dialogTrigger(this);
        }
    }
    class DialogButton extends HTMLButtonElement {
        constructor() {
            super();

            appendActions(this);
        }

        connectedCallback() {
            if (this._isConnected) { return false; } else { this._isConnected = true; }

            dialogTrigger(this);
        }
    }
    customElements.define('modal-link', DialogLink, {extends: 'a'});
    customElements.define('dialog-button', DialogButton, {extends: 'button'});

    const shareTrigger = (shareLink) => {
        shareLink._on('click', async (e) => {
            e.preventDefault();

            const thisElem = e.currentTarget,
            data = {
                title: thisElem.title || document.title,
                text: thisElem._getContent(true),
                url: thisElem.href || window.location.href
            };

            try {
                await window.navigator.share(data);

                console.info('Compartido exitósamente');
            } catch(err) {
                console.error('Error compartiendo: ', err);

                window.location = `mailto:?subject=${data.title}&body=${data.text}%0A${data.url}`;
            }
            
            return false;
        });
    }
    class ShareLink extends HTMLAnchorElement {
        constructor() {
            super();

            appendActions(this);
        }

        connectedCallback() {
            if (this._isConnected) { return false; } else { this._isConnected = true; }

            shareTrigger(this);
        }
    }
    class ShareButton extends HTMLButtonElement {
        constructor() {
            super();

            appendActions(this);
        }

        connectedCallback() {
            if (this._isConnected) { return false; } else { this._isConnected = true; }

            shareTrigger(this);
        }
    }
    customElements.define('share-link', ShareLink, {extends: 'a'});
    customElements.define('share-button', ShareButton, {extends: 'button'});

    const toolTipCreate = (tt) => {
        //if (! tt.id) { tt.id = 'tooltip_' + generateID(); }

        if ('tool-tip-link' == tt.getAttribute('is') && ! tt.href) { tt.href = "javascript:void(0);";}

        const tooltip = create('tool-tip');
        
        //Referencias cruzadas, supongo que es un buen nombre
        tooltip.$el.toggler = tt;
        tt.$el.target = tooltip;

        /* Todos los atributos se describen por sí solos */
        /* tooltip.setAttr = {
            id: tt.dataset.tooltip_id,
            'style-url': tt.dataset.tooltip_style-url,
            style: tt.dataset.tooltip_style,
            script-url: tt.dataset.tooltip_script-url,
            class: tt.dataset.tooltip_class,
            content: tt.dataset.tooltip_content,
            width: tt.dataset.tooltip_width,
            max_width: tt.dataset.tooltip_max_width,
            height: tt.dataset.tooltip_height,
            color: tt.dataset.tooltip_color,
            background_color: tt.dataset.tooltip_background_color,
            arrow_width: tt.dataset.tooltip_arrow_width,
            left_side: tt.dataset.tooltip_left_side,
            right_side: tt.dataset.tooltip_right_side
        }; */

        for (const key in tt.dataset) { if (key.indexOf('tooltip_') + 1) { delete tt.dataset[key]; } }

        tt._on('click', (e) => {
            e.preventDefault();
            
            tt.$el.target.setAtt = {state: 'active'};
        });

        tt.style.position = 'relative';
        tt.style.overflow = 'visible';

        //Esta acción ejecutará 'tool-tip' y hará este elemento el _toggler
        tt.appendChild(tooltip);
        
        return false;
    }
    class ToolTipLink extends HTMLAnchorElement {
        constructor() {
            super();

            appendActions(this);
        }

        connectedCallback() {
            if (this._isConnected) { return false; } else { this._isConnected = true; }

            toolTipCreate(this);
        }
    }
    class ToolTipButton extends HTMLButtonElement {
        constructor() {
            super();

            appendActions(this);
        }

        connectedCallback() {
            if (this._isConnected) { return false; } else { this._isConnected = true; }

            toolTipCreate(this);
        }
    }
    customElements.define('tool-tip-link', ToolTipLink, {extends: 'a'});
    customElements.define('tool-tip-button', ToolTipButton, {extends: 'button'});

    class ScrollProgressBar extends HTMLDivElement {
        connectedCallback() {
            if (this._isConnected) { return false; } else { this._isConnected = true; }

            this.id = generateID();

            let id = this.id;
            let bar = this;

            onDomReady(() => {
                let max = document.body.scrollHeight - window.innerHeight;

                this.appendChild(createStyle(/*css*/`
                    #${id} {
                        position: fixed;
                        width: 0%;
                        height: 4px;
                        background-color: var(--info-color);
                        z-index: 3;
                    }
                `));
    
                document._on('scroll', (e) => { bar.style.width = `${Math.ceil(100 / (max / window.scrollY))}%`; });
            });
            
        }
    }
    customElements.define('scroll-progress-link', ScrollProgressBar, {extends: 'div'});
})();