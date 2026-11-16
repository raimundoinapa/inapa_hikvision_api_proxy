/*
Todos los componentes pueden recibir los attributos Aria que sean necesarios, sin embargo,
si no se detectan algunos básicos y necesarios, estos serán agregados automáticamente
*/
(() => {
    const {
        appendActions, htmlToNode, app, create, sleep, onDomReady, isTextBox, selectFocusable, createStyle, generateID, select, loadFileContent
    } = __CPLIB__;
    
    if (! customElements.get('components-css')) {
        /*
        * Link CSS Global para todos los componentes
        * Ejemplo: <link is="components-css" href="./style.css" rel="stylesheet">
        * Este es el único custom element de este archivo, los demas son components
        */
        class ComponentsCSS extends HTMLLinkElement {
            constructor() { super(); }

            connectedCallback() {
                if (this._isConnected) { return false; } else { this._isConnected = true; }

                app.componentsCSS = this.href;
            }
        }

        customElements.define('components-css', ComponentsCSS, {extends: 'link'});
    }

    /*
    * Todos los parámetros deberían ser auto explicables junto con los comentarios adicionales.
    *
    * Los parámetros onMount, onAttributeChange, onClassChange, onTextChange, onChildrenChange, onAdopt, onUnmount se ejecutan en cada fase que corresponda
    * 
    * Los métodos _onMount, _onAttributeChange, _onClassChange, _onTextChange, _onChildrenChange, _onAdopt, _onUnmount fueron pensados para ser asignados desde
    * afuera de los componentes con el fin de extende su funcionalidad, auque técnicamente se puede llamar desde la función 
    * del parámetro onMount(sin incluir el propio _onMount) usando this para referirse al mismo componente, 
    * ej: this._onAttributeChange
    * 
    * A un componente ya creado y agregado al DOM por html o creado y agregado o por agregar al DOM via javascript,
    * le popodemos extender su funcionalidad y/o acceder a sus propiedades a traves de los métodos 
    * _onAttributeChange, _onClassChange, _onUnmount ya sea seleccionando el componente con select o con su variable, 
    * ej:
    *   const modal = select('a-dialog');
    *   modal._onClassChange((a, b, c)> {});
    * 
    * El método _onMount se puede asignar desde afuera del componente, antes de apendizarlo al DOM
    * 
    * Utilizamos static formAssociated = true; para todos los componentes para asociarlos a cualquier formulario donde se encuentren y 
    * que esten dispobibles en la colección elements. A su vez la propiedad name tiene un setter y un getter para cuplir com el mímimo 
    * necesario para encontrar el componente en la coleccion elements.
    * Esto se puede extender apendizando la interface ElementInternals al componente via onCreate, ej: c._internals = c.attachInternals() 
    * y luego usar métodos como setFormValue imitar imitar y/o extender funcionalidades como la de un input dentro de un formulario con 
    * getters y setters para value, etc. ElementInternals nos ofrece métodos para poner data disponible al formulario y formData como 
    * cualquier otro elemento de formularios
    * 
    * Por defecto, los hijos de los componentes (ej.: <component><h1 slot="head"></h1></component>) serán movidos al shadowRoot,
    * al pariente del slot correspondiente.
    * 
    * Todos componentes tendrán un array $el que contendrá referencias a elementos que tengan la propiedad data-bind="nombreElemento" 
    * de esta manera se accederá a estos elementos así: componente.$el.nombreElemento ó componente.$el['nombreElemento']
    * 
    * Los attributos se manejarán de la siguiente forma:
        1. Si existen y no tienen ningun valor asignado, se asumirá que su valor es true, parecido a la propiedad disabled
        2. Para que un attributo transporte un valor false, el atributo no debe exister o ser igual a false ó 'false'
    * 
    * Atributos especiales que para todos los componentes y elementos dentro de los componentes.
    * Estos serán procesados en connectedCallback antes de onMount:
    *   Atributos en componentes
            style-url = 'https://xxx'                           URL de hoja de estilos
            script-url = 'https://xxx'                          URL de algun archivo .js

    *   Atributos en elementos
            data-light-dom = 'true'                Evita que todos los elementos hijos sean movidos al root (slotted)
            data-light_dom = 'true'                Lo mismo que data-light-dom
            data-bind                                           Apendiza el elemento al array $el del componente
            data-click|mouseup|mousedown|keyup|keydown|focus|focusin|focusout|
                enterup|enterdown|spacebarup|spacebardown|
                arrowkeysup|arrowkeysdown|
                uparrowup|uparrowdown|
                rightarrowup|rightarrowdown|
                leftarrowup|leftarrowup = '_methodName'   Asigna al evento metodo nombrado(Este debe estar dentro del componente)
    *
    * Los eventos 'attributechange' y 'classchange' funcionarán únicamente si se han pasado el o los atributos a monitorear o el 
    * attributo 'class' para el caso 'classchange' a traves de params.observableAttributes. En caso de no haberse pasado parámetro 
    * alguno, se observarán todos los atributos con un MutationObserver
    * 
    * Hay una diferencia entre los eventos 'attributechange' para los componenentes y el de los elementos. El primero siempre devuelve
    * (attributeName, oldValue, newValue) porque esta basado en attributeChangedCallback, mientras que para los elementos
    * se utiliza el MutationObserver que solo devuelve (attributeName, oldValue)
    * 
    * Los componentes con classchange y attibutechange se le agregarán las propiedades _classChangeEvent y _attributeChangeEvent de uso interno
    * para cuando se quieran remover los eventos con ._removeOn
    * 
    * Todos los componentes puede recibir los estilos por varias vías
        1. Atributo style-url con una url a una hora de estilos
        2. Añadiendo bloques <style> como hijos en el coponente <web-component><style>...</style></web-component>
        3. Accediendo desde afuera a los a los elementos expuestos a traves de la propiedad part (:host(.partname))
        4. Actualizando variables CSS component.style.setProperty('--css-var', 'value');
    *
    * Todos los componentes puede recibir scripts por varias vias
        1. Atributo script-url con una url a una hora de estilos
        2. Añadiendo bloques <script> como hijos en el coponente <web-component><script>...</script></web-component>
    * 
    */
    const defineCustomElement = function(params = {
        tag: '', mode: '', innerHTML: '', htmlToNode: '', childNode: false, parseDocument: '',
        observableAttributes: ['class', 'tabindex', 'disabled', 'aria-pressed', 'aria-expanded', 'aria-controls', 'state'],
        onCreate: false, onMount: false, onAttributeChange: false, onClassChange: false, onTextChange: false, onChildrenChange: false, onAdopt: false, onUnmount: false}) {

        params.mode = params.mode || 'open';
        
        customElements.define(params.tag, class extends HTMLElement {
            static formAssociated = true;//Todos los componentes podrán ser asociados a un formulario si se encuentran dentro de uno

            constructor() {
                super();

                //Estas propiedades pueden ser utilizadas por las funciones select y appendActions
                this._isHost = true;
                this._root = this.attachShadow({mode: params.mode});
                this._root._isRoot = true;

                appendActions(this);
                appendActions(this._root);

                this._globalCallback(params.onCreate);
            }

            //Función especial filtra los atributos que se notifiquen cuando attributeChangedCallback sea invocado
            static get observedAttributes() {
                let attrs = params.observableAttributes;

                if (attrs) { return attrs; }
            }

            //Setter de atributos
            set setAttr(obj = {}) {
                if ('string' == typeof obj) {
                    this.setAttribute(obj, '');

                    return true;
                }
                
                for (let prop in obj) { this.setAttribute(prop, obj[prop].toString()); }
            }

            //Removedor de atributes
            set remAttr(arr = []) {
                if ('string' ==  typeof arr) { arr = [arr]; }

                arr.forEach((a) => { this.removeAttribute(a); });
            }
    
            //Getter de atributos
            get getAttr() {
                const attr = {}
                const attrList = this.attributes;

                for (const at of attrList) { if (at.nodeName) { attr[at.nodeName] = "" === at.nodeValue ? true : at.nodeValue; } }
            
                return attr;
            }

            //Setter de propiedades
            set setProp(obj = {}) { for (let prop in obj) { this[prop] = obj[prop]; } }

            //Getter de atributos en observación
            get currentlyObserved() { return params.observableAttributes || []; }

            //Setter y getter del atributo name en el componente, especialmente para la colección elements del formularios
            set name(name) { this.setAttribute('name', name); }
            get name() { return this.getAttribute('name'); }

            /*
            * Usamos este método personalizado para llamar cualquier método que se envíe
            * durante cualquier fase del ciclo de vida del componente
            */
            _globalCallback(fnc = false, params = []) {
                if (! fnc) { return false; }

                if (! params.length) { fnc(this); } else { fnc.apply(this, params); }
            }

            _bindInteractiveElements() {
                //Activamos los elementos interactivos, asignando eventos y apendizando elementos al componente, los elementos apendizados son almacenadas en el objeto $el
                let events = [
                    'click',
                    'mouseup', 'mousedown',
                    'keyup', 'keydown',
                    'focus', 'focusin', 'focusout',
                    'enterup', 'enterdown',
                    'escapeup', 'escapedown',
                    'spacebarup', 'spacebardown',
                    'arrowkeysup', 'arrowkeysdown',
                    'uparrowup', 'uparrowdown',
                    'rightarrowup', 'rightarrowdown',
                    'downarrowup', 'downarrowdown',
                    'leftarrowup', 'leftarrowup',
                    'attributechange', 'classchange', 'textchange', 'childrenchange'
                ];

                let flagsName = events.map(fn => '_hasOn' + fn.charAt(0).toUpperCase() + fn.slice(1));//'_hasOnClick', '_hasOnKeyup'
                let query = events.map(q => '[data-' + q + ']').join(', ') + ', [data-bind]';
                let re = this._select(query, true);

                for (let ee of re) {
                    for (let pos = 0; pos < events.length; pos++) {
                        let fncName = ee.dataset[events[pos]];

                        if (fncName) {
                            if (! ee[flagsName[pos]]) {
                                ee[flagsName[pos]] = true;
                                
                                ee._on(events[pos], (e) => { this[fncName](e); });
                            }
                        }
                    }

                    let bindName = ee.dataset.bind;

                    if (bindName) { this.$el[bindName] = ee; }
                }
            }
            
            _relocateChildren() {
                const host = this;

                //Por razones de tiempos de carga, si el script se llama sin async, host.childNodes.length puede que no obtenga el número real de hijos, 
                //es decir, que este valor no es no es confiable para determinar cuando el slotchange finalizó usando un un contador.
                //Otro problema es cuando el componente no tiene hijos, pero tiene elementos slot, el slotchange nunca se ejecuta, y por ende tampoco el 
                //_bindInteractiveElements, dejando elementos sin hacerle bind por fuera.
                //OJO: 👀 Super hack, luego de muchísmos problemas tratando de solucionar lo antes expuesto, solucionamos de la siguiente manera:
                //Insertar un nodo vacío para aseguramos de que slotchange se ejecute al menus una vez, y pensabamos que este nodo se apendizaría al final
                //para luego detectarlo al final del bucle, pero en realidad se inserta de primero. Dicho esto decidimos comparar dos valores, uno con un 
                //contador global que suma el total de hijos en cada slotchange y otro con un contador de hijos movidos, pero estos uponia un problema adicional, 
                //en los casos donde slotchange sería llamado varias veces, los valores darían igual al momento de mover el último hijo del primer slotchange, 
                //dando como resultado true antes de la ejecución de los demas slotchange, por eso decidimos poner la comprobación dentro de un setTimeout a 
                //10 milisegundos para por lo menos darle chance una segunde ejecución de slotchange y esto dió resultado positivo, pero luego nos dimos cuenta 
                //que el setTimeout se ejecutaba el mismo numero de veces que slotchange, pero con el resultado final esperado, luego bajamos el tiempo a cero 
                //a ver que pasaba y el resultado era correcto y nos acordamos de que setTimeout lo que hacía era ponerse al final del stack de ejecución, lo 
                //cual resultó ser muy conveniente, luego usamos un flag para no ejecutar el setTimeout más de una vez 😱😱😱
                const slotchangeTriggerNode = document.createTextNode("");
                let globalChildrenCount = 0;
                let globalChildrenMovedCount = 0;
                let slotchangeFinished = false;

                return new Promise((resolve) => {
                    host._root._on('slotchange', (e) => {
                        const slot = appendActions(e.target);
                        const children = e.target.assignedNodes();//Incluye textNodes
    
                        //OJO: De algún modo e.target.assignedNodes() puede contener un array vacío
                        if (children.length) { globalChildrenCount += children.length; }

                        children.forEach((elem) => {
                            if (! elem?.dataset?.lightDom && ! elem?.dataset?.light_dom) { slot._insertBefore(elem); }

                            globalChildrenMovedCount++;

                            if (globalChildrenMovedCount == globalChildrenCount && ! slotchangeFinished) {
                                slotchangeFinished = true;

                                setTimeout(() => {
                                    host._bindInteractiveElements();
    
                                    resolve(true);
                                }, 0);
                            }
                        });
                    });

                    host.appendChild(slotchangeTriggerNode);
                });
            }

            async connectedCallback() {
                /*
                * Los compomentes anidados hacen que el connectedCallback se ejecute mas de una vez, asi que controlo
                * que se ejecuten una única vez a traves de este flag
                */                
                if (this._isConnected) { return false; }

                this._isConnected = true;

                const attr = this.getAttr;

                if (attr['style-url']) {
                    this._root.appendChild(create('link', false, {href: attr['style-url'], rel: "stylesheet"}));
    
                    delete attr['style-url'];
                }
    
                if (attr['script-url']) {
                    this._root.appendChild(create('script', false, {src: attr['script-url'], defer: 'true'}));

                    delete attr['script-url'];
                }

                if (params.parseDocument) {
                    params.childNode = new DOMParser().parseFromString(params.parseDocument, "text/html").documentElement;
                }
    
                if (params.innerHTML) { params.childNode = htmlToNode(params.innerHTML); }
                
                if (params.childNode) { this._root.appendChild(params.childNode); }

                //Dejamos las rutas de la librería cp en caso de que el componente la necesite, asi como algun css global
                if (app.helperScript) {
                    let src = app.helperScript;
                    let cssSrc = src.replace('js/helper.js', 'css/helper.css');
                    let css = create('link', false, {href: cssSrc, rel: "stylesheet"});
                    
                    if (app.componentsCSS) { this._root.prepend(create('link', false, {href: app.componentsCSS, rel: "stylesheet"})); }
    
                    this._root.prepend(css);
                }

                if (! this._select('slot', true).length) {
                    this._bindInteractiveElements();
                } else {
                    await this._relocateChildren();
                }

                this._globalCallback(params.onMount);
                this._globalCallback(this._onMount);
            }
    
            //En caso de ejecutarse, pasamos la ejecución al _globalCallback con todos los argumentos (name, oldValue, newValue)
            attributeChangedCallback() {
                this._globalCallback(params.onAttributeChange, arguments);
                this._globalCallback(this._onAttributeChange, arguments);

                if ('class' == arguments[0]) {
                    this._globalCallback(params.onClassChange, arguments);
                    this._globalCallback(this._onClassChange, arguments);
                }
            }
    
            adoptedCallback() {
                this._globalCallback(params.onAdopt);
                this._globalCallback(this._onAdopt);
            }
    
            disconnectedCallback() {
                this._globalCallback(params.onUnmount);
                this._globalCallback(this._onUnmount);
            }
        });
    }

    const convertToFormElement = (btn) => {
        btn._internals = btn.attachInternals();

        //Getters y Setters de ElementInternals para dar comportamiento parecido a un input, tanto fuera como dentro de un formulario
        Object.defineProperty(btn, 'type', {
            set(type) { this.setAttribute('type', type); },
            get() { return this.getAttribute('type') || this.localName; }
        });

        Object.defineProperty(btn, 'tabindex', {
            set(tabIndex) { this.setAttribute('tabindex', tabIndex); },
            get() { return this.getAttribute('tabindex'); }
        });

        Object.defineProperty(btn, 'value', {
            get() { return ! this._value ? '' : this._value; },
            set (value) {
                this._value = value;

                this._internals.setFormValue(value);
            }
        });

        //Devuelve el nombre del formulario al que el componente pertenece de estar insertado en uno
        Object.defineProperty(btn, 'form', { get() { return this._internals.form; } });

        //Como esto es un botón, si se hace una validación con validity esta debería ser true
        btn.validity = {valid: true}
    }

    const commonStyles = `
        :host {
            /*OJO: Evaluar esto -> all: revert;*/
            all: initial;
            visibility: inherit;
            position: inherit;   
            direction: ltr;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            text-rendering: optimizeLegibility;
            color: var(--text-color-1);

            --bgc-1: var(--neutral-1);
            --bgc-2: var(--neutral-2);
            --bgc-dark: var(--neutral-dark);
        }
        :host([disabled]) {
            opacity: var(--disabled-opacity);
            user-select: none;
            cursor: not-allowed;
        }
        :host([info]), :host([severity='info']) {
            --bgc-1: var(--info-1);
            --bgc-2: var(--info-2);
            --bgc-dark: var(--info-dark);
            --bgc-transparent-1: var(--info-transparent-1);
        }
        :host([success]), :host([severity='success']) {
            --bgc-1: var(--success-1);
            --bgc-2: var(--success-2);
            --bgc-dark: var(--success-dark);
            --bgc-transparent-1: var(--success-transparent-1);
        }
        :host([warning]), :host([severity='warning']) {
            --bgc-1: var(--warning-1);
            --bgc-2: var(--warning-2);
            --bgc-dark: var(--warning-dark);
            --bgc-transparent-1: var(--warning-transparent-1);
        }
        :host([danger]), :host([severity='danger']) {
            --bgc-1: var(--danger-1);
            --bgc-2: var(--danger-2);
            --bgc-dark: var(--danger-dark);
            --bgc-transparent-1: var(--danger-transparent-1);
        }
        :host([accent]), :host([severity='accent']) {
            --bgc-1: var(--accent-1);
            --bgc-2: var(--accent-2);
            --bgc-dark: var(--accent-dark);
            --bgc-transparent-1: var(--accent-transparent-1);
        }

        @media (prefers-reduced-motion: no-preference) {
            html,
            :host,
            :has(:target) {
                scroll-behavior: smooth;
                scroll-padding-top: 0.5rem;
            }
        }
    `;

    /*
     * Utilizamos vectores SVG y algúnos símbolos unicode como íconos
     * Muchos de los SVG estan basados en la librería Boxicons
     * Para el tamaño de los íconos tomamos el tamaño de la fuente del ancestro del host (1em), la que se le aplique al host directamente 
     * via css o la dimensión que se envíe por el parámetro font-size o size.
     * 
     * Hicimos varios cálculos para mantener la uniformidad entre los símbolols unicode y los svg.
     * 
     * Modificamos contenedores SVG para que los viewBox sean del tamaño exacto de los trazos, sin exesos en ninguno de los lados y
     * utilizamos las propiedades preserveAspectRatio="xMidYMid meet" para crear los espacios necesarios y mantener los trazos centrados
     * en los casos donde el acho es diferente al alto y de esta forma cumplir con el aspect ratio 1 / 1. Por ejemplo: el simbolo
     * - (minus) en svg el width sería mucho mayor al height, pero con los parametros, se crea el espacio necesario para que svg sea
     * cradrado, quedando el trazo centrado verticalmente en el centro y el svg seguiría siendo cuadrado.
     * 
     * Para crear uniformidad entre los simbolos unicode y los svg, nos dimos cuenta que el alto de los unicode es mas o menos el 70%
     * del tamaño de la fuente (al igual que las letras mayúsculas), esto es así debido a que 1em puede ser superior al tamaño promedio
     * de una letra cualquiera mayúscula, por ejemplo, la letra j, ya que esta, así como otras letras como la p, alínean la parte inferior
     * por debajo del nivel de letras como la o, a, c, etc, mientras los íconos unicode se alinearán como cualquier letra mayúscula.
     * De este modo el tamaño del host es 0.7em con un aspect ration 1 / 1 para íconos del tamaño de una letra mayúscula.
     * 
     * Usando el parametro lowercase hacemos que los íconos adopeten el tamaño de una letra minúscula como la o, a, c, etc. Este cálculo
     * se hace tomando en cuenta que la letra minúscula es aproximadamente un 70% del tamaño de la letra mayúscula, es decir, que con solo
     * reducir el font-size un 30% obtenemos dicho resultado.
     * 
     * Cuando se envía el parámetro font-size el igual que aplicar el tamaño de la fuenta via css o modificar la variable --font-size 
     * via component.style.setProperty('--font-size', 'valor')
     * 
     * Cuando se envía el parámetro size asumimos dimensiones exactas con un aspect ration 1 / 1, por ejemplo size="64px" creará un host 
     * 64px por 64px. Los SVG se adaptan facilmente sin ningun cálculo adicional, pero para los símbolos unicode tenemos que asumir que el 
     * size indicado es equivalente a un 70% del font-size real e incrementar la fuente (size /= 0.7), para que el ícono ocupe visualmente 
     * al menos la altura deseada (Dependiendo del tamaño usado puede que salgan 1 o 2 pixeles más grande).
     *
     * 
     * Atributos
        * size              //Tamaño en cualquier unidad ó s, m, l ó xl
        * s                 //Lo mismo que size="s" ó size="16px"
        * m                 //Lo mismo que size="m" ó size="24px"
        * l                 //Lo mismo que size="l" ó size="32px"
        * xl                //Lo mismo que size="xl" ó size="40px"
        * font-size         //Alias de size
        * color
        * animate           //Solo para algunos íconos
        * hungup            //Solo para el ícono phone. Lo voltea para que quede horizontal
        * flip              //Voltea el ícono
        * horizontal-flip   //Voltea el ícono horizontalmente
        * vertical-flip   //Voltea el ícono verticalmente
     * 
     * Variables CSS
        * --color
        * --font-size
    */
   /*
        //OJO: eye-open y eye-closed son de Binance, sin modificaciones, tengo que modificarlas
        //OJO: save le falta el viewBox
        //OJO: Evaluar estas líneas
        <!--This SVG ELEMENT CONTAINS SVG DEFINITION-->
        <svg aria-hidden="true" style="position: absolute; width: 0; height: 0; overflow: hidden;" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
            <defs>
                <symbol id="icon-twitter" viewBox="0 0 32 32">
                    <title>twitter</title>
                    <path d="M32 7.075c-1.175 0.525-2.444 0.875-3.769 1.031 1.356-0.813 2.394-2.1 2.887-3.631-1.269 0.75-2.675 1.3-4.169 1.594-1.2-1.275-2.906-2.069-4.794-2.069-3.625 0-6.563 2.938-6.563 6.563 0 0.512 0.056 1.012 0.169 1.494-5.456-0.275-10.294-2.888-13.531-6.862-0.563 0.969-0.887 2.1-0.887 3.3 0 2.275 1.156 4.287 2.919 5.463-1.075-0.031-2.087-0.331-2.975-0.819 0 0.025 0 0.056 0 0.081 0 3.181 2.263 5.838 5.269 6.437-0.55 0.15-1.131 0.231-1.731 0.231-0.425 0-0.831-0.044-1.237-0.119 0.838 2.606 3.263 4.506 6.131 4.563-2.25 1.762-5.075 2.813-8.156 2.813-0.531 0-1.050-0.031-1.569-0.094 2.913 1.869 6.362 2.95 10.069 2.95 12.075 0 18.681-10.006 18.681-18.681 0-0.287-0.006-0.569-0.019-0.85 1.281-0.919 2.394-2.075 3.275-3.394z"></path>
                </symbol>
                <symbol id="icon-facebook" viewBox="0 0 32 32">
                    <title>facebook</title>
                    <path d="M29 0h-26c-1.65 0-3 1.35-3 3v26c0 1.65 1.35 3 3 3h13v-14h-4v-4h4v-2c0-3.306 2.694-6 6-6h4v4h-4c-1.1 0-2 0.9-2 2v2h6l-1 4h-5v14h9c1.65 0 3-1.35 3-3v-26c0-1.65-1.35-3-3-3z"></path>
                </symbol>
                <symbol id="icon-instagram" viewBox="0 0 32 32">
                    <title>instagram</title>
                    <path d="M16 2.881c4.275 0 4.781 0.019 6.462 0.094 1.563 0.069 2.406 0.331 2.969 0.55 0.744 0.288 1.281 0.638 1.837 1.194 0.563 0.563 0.906 1.094 1.2 1.838 0.219 0.563 0.481 1.412 0.55 2.969 0.075 1.688 0.094 2.194 0.094 6.463s-0.019 4.781-0.094 6.463c-0.069 1.563-0.331 2.406-0.55 2.969-0.288 0.744-0.637 1.281-1.194 1.837-0.563 0.563-1.094 0.906-1.837 1.2-0.563 0.219-1.413 0.481-2.969 0.55-1.688 0.075-2.194 0.094-6.463 0.094s-4.781-0.019-6.463-0.094c-1.563-0.069-2.406-0.331-2.969-0.55-0.744-0.288-1.281-0.637-1.838-1.194-0.563-0.563-0.906-1.094-1.2-1.837-0.219-0.563-0.481-1.413-0.55-2.969-0.075-1.688-0.094-2.194-0.094-6.463s0.019-4.781 0.094-6.463c0.069-1.563 0.331-2.406 0.55-2.969 0.288-0.744 0.638-1.281 1.194-1.838 0.563-0.563 1.094-0.906 1.838-1.2 0.563-0.219 1.412-0.481 2.969-0.55 1.681-0.075 2.188-0.094 6.463-0.094zM16 0c-4.344 0-4.887 0.019-6.594 0.094-1.7 0.075-2.869 0.35-3.881 0.744-1.056 0.412-1.95 0.956-2.837 1.85-0.894 0.888-1.438 1.781-1.85 2.831-0.394 1.019-0.669 2.181-0.744 3.881-0.075 1.713-0.094 2.256-0.094 6.6s0.019 4.887 0.094 6.594c0.075 1.7 0.35 2.869 0.744 3.881 0.413 1.056 0.956 1.95 1.85 2.837 0.887 0.887 1.781 1.438 2.831 1.844 1.019 0.394 2.181 0.669 3.881 0.744 1.706 0.075 2.25 0.094 6.594 0.094s4.888-0.019 6.594-0.094c1.7-0.075 2.869-0.35 3.881-0.744 1.050-0.406 1.944-0.956 2.831-1.844s1.438-1.781 1.844-2.831c0.394-1.019 0.669-2.181 0.744-3.881 0.075-1.706 0.094-2.25 0.094-6.594s-0.019-4.887-0.094-6.594c-0.075-1.7-0.35-2.869-0.744-3.881-0.394-1.063-0.938-1.956-1.831-2.844-0.887-0.887-1.781-1.438-2.831-1.844-1.019-0.394-2.181-0.669-3.881-0.744-1.712-0.081-2.256-0.1-6.6-0.1v0zM16 7.781c-4.537 0-8.219 3.681-8.219 8.219s3.681 8.219 8.219 8.219 8.219-3.681 8.219-8.219c0-4.537-3.681-8.219-8.219-8.219zM16 21.331c-2.944 0-5.331-2.387-5.331-5.331s2.387-5.331 5.331-5.331c2.944 0 5.331 2.387 5.331 5.331s-2.387 5.331-5.331 5.331zM26.462 7.456c0 1.060-0.859 1.919-1.919 1.919s-1.919-0.859-1.919-1.919c0-1.060 0.859-1.919 1.919-1.919s1.919 0.859 1.919 1.919z"></path>
                </symbol>
            </defs>
        </svg>

        <svg><use xlink:href="#icon-twitter"></use></svg>                
    */
    if (! customElements.get('an-icon')) {
        defineCustomElement({tag: 'an-icon', mode: 'closed',
            onCreate: (ai) => {
                ai.$icons = {
                    'minus-u': '⚊',
                    'plus-u': '✚',
                    'x-u': {icon: 'plus-u', style: 'transform: rotate(45deg);'},
                    'x-alt-u': '✖︎',
                    'plus-alt-u': {icon: 'x-alt-u', style: 'transform: rotate(45deg);'},
                    'chevron-left-u': '❮',
                    'chevron-right-u': '❯',
                    'check-u': '☑',
                    'check-alt-u': '✔',
                    'play-u': '▶',
                    'refresh-u': '⭮',
                    'settings-u': '🛠',
                    'warning-u': '⚠',
                    'clock-u': {icon: '⏱', style: 'font-size: 0.7em; position: relative; top: -0.127em;'},
                    'pause-u': {icon: '⏸', style: 'font-size: 0.7em; position: relative; top: -0.127em;'},
                    'x': `<svg viewBox="0 0 24 24"><path d="M24,2.5L21.5,0L12,9.5L2.5,0L0,2.5L9.5,12L0,21.5L2.5,24l9.5-9.5l9.5,9.5l2.5-2.5L14.5,12C14.5,12,24,2.5,24,2.5z"/></svg>`,
                    'plus': {icon: 'x', style: 'transform: rotate(45deg); width: 75%;'},
                    'minus': `<svg viewBox="0 0 24 3.5" preserveAspectRatio="xMidYMid meet"><path d="M0,3.5V0h24v3.5H0z"/></svg>`,
                    'plus-circle': `<svg viewBox="0 0 24 24"><path d="M12,0C5.5,0,0,5.5,0,12s5.5,12,12,12s12-5.5,12-12S18.5,0,12,0z M12,22c-5.4,0-9.9-4.6-9.9-10S6.6,2,12,2s9.9,4.6,9.9,10 S17.4,22,12,22z"/><path d="M18.7,13.3l0-2.7h-5.4V5.3h-2.7v5.4H5.3l0,2.7h5.4v5.4l2.7,0v-5.4L18.7,13.3z"/></svg>`,
                    'x-circle': {icon: 'plus-circle', style: 'transform: rotate(45deg);'},
                    'minus-circle': '<svg viewBox="0 0 24 24"><path d="M12,0C5.5,0,0,5.5,0,12s5.5,12,12,12s12-5.5,12-12S18.5,0,12,0z M12,22c-5.4,0-9.9-4.6-9.9-10S6.6,2,12,2s9.9,4.6,9.9,10 S17.4,22,12,22z M17.3,13.4v-2.9L5.8,10.6v2.9L17.3,13.4z"/></svg>',
                    'edit-circle': `<svg viewBox="0 0 24 24"><path d="M12,0C5.5,0,0,5.5,0,12s5.5,12,12,12s12-5.5,12-12S18.5,0,12,0z M12,22c-5.4,0-9.9-4.6-9.9-10S6.6,2,12,2s9.9,4.6,9.9,10 S17.4,22,12,22z"/><rect x="14.6" y="6.4" transform="matrix(0.7071 -0.7071 0.7071 0.7071 -1.0758 13.6163)" width="2.6" height="3.4"/><polygon points="6,15.6 6,18 8.4,18 15,11.4 12.6,9 "/></svg>`,
                    'info-circle': `<svg viewBox="0 0 24 24"><path d="M10.8,10.8c0-0.7,0.5-1.2,1.2-1.2s1.2,0.5,1.2,1.2V18c0,0.7-0.5,1.2-1.2,1.2s-1.2-0.5-1.2-1.2V10.8z"/><path d="M12,4.9c-0.7,0-1.2,0.5-1.2,1.2c0,0.7,0.5,1.2,1.2,1.2s1.2-0.5,1.2-1.2C13.2,5.4,12.7,4.9,12,4.9z"/><path fill-rule=evenodd clip-rule=evenodd d="M12,0C5.4,0,0,5.4,0,12c0,6.6,5.4,12,12,12c6.6,0,12-5.4,12-12C24,5.4,18.6,0,12,0z M2.4,12 c0,5.3,4.3,9.6,9.6,9.6c5.3,0,9.6-4.3,9.6-9.6c0-5.3-4.3-9.6-9.6-9.6C6.7,2.4,2.4,6.7,2.4,12z"/></svg>`,
                    'plus-full-screen': `<svg viewBox="0 0 24 24"><path d="M2.7,2.7h6.7V0H0v9.3h2.7V2.7z M9.3,21.3H2.7v-6.7H0V24h9.3V21.3z M24,14.7h-2.7v6.7h-6.7V24H24V14.7z M21.3,9.3H24V0h-9.3 v2.7h6.7V9.3z"/><path d="M18.7,13.3v-2.7h-5.4V5.2h-2.7v5.4H5.3v2.7h5.4v5.4h2.7v-5.4L18.7,13.3z"/></svg>`,
                    'edit-full-screen': `<svg viewBox="0 0 24 24"><path d="M2.7,2.7h6.7V0H0v9.3h2.7V2.7z M9.3,21.3H2.7v-6.7H0V24h9.3V21.3z M24,14.7h-2.7v6.7h-6.7V24H24V14.7z M21.3,9.3H24V0h-9.3 v2.7h6.7V9.3z"/><rect x="14.6" y="6.4" transform="matrix(0.7071 -0.7071 0.7071 0.7071 -1.0823 13.6092)" width="2.6" height="3.4"/><polygon points="6,15.6 6,18 8.4,18 15,11.4 12.6,9 "/></svg>`,
                    'avatar': `<svg viewBox="0 0 24 24"><style type="text/css">.st0{fill:currentColor;opacity:0.2} .st1{fill:currentColor;}</style><path class="st0" d="M12,0c6.6,0,12,5.4,12,12s-5.4,12-12,12C5.4,24,0,18.6,0,12S5.4,0,12,0z"/><g><path class="st1" d="M19.6,19.4c-0.1-0.1-0.2-0.2-0.2-0.3c-0.1-0.1-0.2-0.3-0.3-0.4c-0.1-0.1-0.2-0.3-0.4-0.4 c-0.2-0.2-0.4-0.4-0.7-0.6c-0.4-0.3-0.7-0.6-1.2-0.8c-0.2-0.1-0.4-0.2-0.7-0.3c0,0,0,0,0,0c-1.1-0.5-2.5-0.9-4.2-0.9 S8.8,16,7.7,16.5c0,0-0.1,0-0.1,0.1c-0.2,0.1-0.5,0.2-0.7,0.4c-0.4,0.2-0.7,0.5-1,0.7c-0.2,0.2-0.5,0.4-0.7,0.6 c-0.1,0.1-0.2,0.3-0.4,0.4c-0.1,0.1-0.2,0.2-0.3,0.4c-0.1,0.1-0.2,0.2-0.2,0.3c-0.1,0.1-0.1,0.2-0.2,0.3c0,0,0,0,0,0 c0,0.1-0.1,0.1-0.1,0.2c-0.1,0.1-0.1,0.2-0.1,0.2v0c2.1,2,4.9,3.3,8.1,3.3c3.1,0,6-1.3,8.1-3.3v0c0,0-0.1-0.2-0.2-0.4 C19.7,19.6,19.7,19.5,19.6,19.4L19.6,19.4z M12,14.2c0.3,0,0.6,0,0.9-0.1c0.1,0,0.3-0.1,0.4-0.1c0.2-0.1,0.4-0.1,0.6-0.2 c0.2-0.1,0.5-0.3,0.7-0.4c0.4-0.3,0.8-0.7,1.1-1.2c0.1-0.2,0.2-0.4,0.3-0.5c0.1-0.2,0.1-0.4,0.2-0.6c0-0.1,0.1-0.3,0.1-0.4 c0-0.2,0-0.4,0-0.7c0-0.2,0-0.4,0-0.7c0-0.2-0.1-0.4-0.1-0.6c-0.1-0.3-0.2-0.6-0.4-0.9c-0.3-0.5-0.6-0.9-1.1-1.2 c-0.2-0.2-0.5-0.3-0.7-0.4C13.6,6,13.5,6,13.3,5.9c-0.1,0-0.3-0.1-0.4-0.1c-0.3-0.1-0.6-0.1-0.9-0.1c-2.4,0-4.2,1.8-4.2,4.2 C7.7,12.3,9.6,14.2,12,14.2L12,14.2z"/></g></svg>`,
                    'back-arrow': `<svg viewBox="0 0 24 24"><path d="M12,0l2.1,2.1l-8.4,8.4H24v3H5.7l8.4,8.4L12,24L0,12L12,0z"/></svg>`,
                    'arrow-down-left': `<svg viewBox="0 0 24 24"><path d="M0,1.4h4v15.8L21.2,0L24,2.8L6.8,20h15.8v4H0V1.4z"/></svg>`,
                    'arrow-up-right': {icon: 'arrow-down-left', style: 'transform: rotate(180deg);'},
                    'blocked': `<svg viewBox="0 0 24 24"><path d="M12,0C5.4,0,0,5.3,0,12s5.3,12,12,12s12-5.3,12-12S18.6,0,12,0z M3,12c0-4.9,4.1-9,9-9c2,0,3.8,0.6,5.3,1.7L4.7,17.3 C3.6,15.8,3,14,3,12z M12,21c-2,0-3.7-0.6-5.2-1.7L19.3,6.8C20.4,8.3,21,10,21,12C21,16.9,16.9,21,12,21z"/></svg>`,
                    'chat': `<svg viewBox="0 0 24 24"><path d="M21.3,0h-19C0.9,0,0,0.8,0,2.2V24l4.7-4.7h16.6c1.4,0,2.7-1.4,2.7-2.8V2.2C24,0.8,22.6,0,21.3,0z M14.6,13.3H5.4v-2.6h9.3 C14.6,10.7,14.6,13.3,14.6,13.3z M18.6,7.9H5.4V5.3h13.2C18.6,5.3,18.6,7.9,18.6,7.9z"/></svg>`,
                    'check': `<svg viewBox="0 0 24 21.5" preserveAspectRatio="xMidYMid meet"><path d="M23.7,1.1l-1.1-0.9c-0.4-0.3-0.9-0.2-1.2,0.1L8.7,16.5c-0.2,0.3-0.7,0.4-1,0.2c0,0-0.1,0-0.1-0.1l-5.2-5 c-0.3-0.3-0.9-0.3-1.2,0l-1,1c-0.3,0.3-0.3,0.9,0,1.2l7.7,7.5c0.3,0.3,0.8,0.3,1.1,0c0,0,0.1-0.1,0.1-0.1L23.8,2.3 C24.1,1.9,24,1.3,23.7,1.1z"/></svg>`,
                    'chevron-left': `<svg viewBox="0 0 14.8 24" preserveAspectRatio="xMidYMid meet"><path d="M14.8,21l-9.2-9l9.2-9.2L12,0L0,12l12,12C12,24,14.8,21,14.8,21z"/></svg>`,                    
                    'chevron-right': {icon: 'chevron-left', style: 'transform: scaleX(-1);'},
                    'clip': `<svg viewBox="0 0 24 21.4" preserveAspectRatio="xMidYMid meet"><path d="M0,14.7L0,14.7c0,1.8,0.7,3.5,2,4.7c1.3,1.3,2.9,2,4.7,2c1.8,0,3.5-0.7,4.7-2L22.7,8.1C23.6,7.2,24.1,6,24,4.7 c-0.1-1.1-0.7-2.3-1.6-3.2c-1.9-1.9-4.8-2-6.6-0.3l-9.4,9.4c-1,1-0.9,2.7,0.3,3.9c1.1,1.1,2.9,1.3,3.9,0.3l6.5-6.5 c0.3-0.3,0.3-0.9,0.1-1.1l-0.3-0.3c-0.2-0.2-0.7-0.4-1.1,0l-6.5,6.5c-0.2,0.2-0.8,0.2-1.2-0.3C8,13,7.4,12.4,7.8,12l9.4-9.4 c1-1,2.7-0.8,3.8,0.3c0.6,0.6,1,1.3,1,2c0.1,0.7-0.2,1.3-0.7,1.8L10,18c-0.9,0.9-2.1,1.4-3.4,1.4c-1.3,0-2.5-0.5-3.4-1.4 c-0.9-0.9-1.4-2.1-1.4-3.4c0-1.3,0.5-2.5,1.4-3.4l8.6-8.6c0.2-0.2,0.3-0.7,0-1l-0.4-0.4c-0.3-0.3-0.7-0.3-1,0c0,0,0,0,0,0L2,10 C0.7,11.2,0,12.9,0,14.7z"/></svg>`,
                    'clock': `<svg viewBox="0 0 24 24"><path d="M22.3,12c0-5.7-4.6-10.3-10.3-10.3C6.3,1.7,1.7,6.3,1.7,12c0,0,0,0,0,0c0,5.7,4.6,10.3,10.3,10.3 C17.7,22.3,22.3,17.7,22.3,12z M24,12c0,6.6-5.4,12-12,12C5.4,24,0,18.6,0,12C0,5.4,5.4,0,12,0S24,5.4,24,12z M12.2,5.7v6.8l5.3,3.2 c0.4,0.2,0.5,0.8,0.3,1.2c-0.2,0.4-0.8,0.5-1.2,0.3l-6.1-3.7V5.7c0-0.5,0.4-0.8,0.8-0.8C11.8,4.8,12.2,5.2,12.2,5.7 C12.2,5.7,12.2,5.7,12.2,5.7L12.2,5.7z"/></svg>`,
                    'download': `<svg viewBox="0 0 20 24" preserveAspectRatio="xMidYMid meet"><path d="M19.9,8.4h-5.7V0H5.7v8.4H0l9.9,9.9C9.9,18.3,19.9,8.4,19.9,8.4z M0.1,21.1V24H20v-2.9H0.1z"/></svg>`,
                    'upload': {icon: 'download', style: 'transform: scaleY(-1);'},
                    'forward': `<svg viewBox="0 0 24 18" preserveAspectRatio="xMidYMid meet"><path d="M14.7,1c0-0.9,1.1-1.3,1.7-0.7l7.3,7.3c0.4,0.4,0.4,1,0,1.4c0,0,0,0,0,0l-7.3,7.3c-0.4,0.4-1,0.4-1.4,0 c-0.2-0.2-0.3-0.4-0.3-0.7v-3.3c-6.2,0-10.7,1.8-14,5.6c-0.3,0.3-0.8,0.1-0.7-0.4C1.7,11.2,6,5.4,14.7,4.1C14.7,4.1,14.7,1,14.7,1z"/></svg>`,
                    'history': `<svg viewBox="0 0 24 24"><path d="M12,6.7v6.7h6v-2.7h-3.6v-4H12z"/><path d="M23.2,7.3c-0.5-1.4-1.3-2.7-2.3-3.8c-1.5-1.7-3.4-2.8-5.5-3.3c-1.4-0.3-2.9-0.3-4.4,0C9,0.7,7.1,1.9,5.6,3.5	c-1,1.1-1.8,2.4-2.3,3.8C2.7,8.8,2.4,10.4,2.4,12l0,0H0l3.6,5.3L7.2,12H4.8l0,0c0-1.9,0.5-3.7,1.4-5.2c0.6-1,1.4-1.9,2.3-2.5	c0.9-0.7,1.9-1.2,3-1.4c4.5-1,9,2.2,9.9,7.3c0.2,1.2,0.2,2.5,0,3.8c-0.2,1.2-0.6,2.3-1.3,3.3c-0.3,0.5-0.6,1-1,1.4	c-0.8,0.9-1.7,1.5-2.7,2c-0.5,0.2-1,0.4-1.6,0.5c-1.1,0.3-2.3,0.3-3.4,0c-1.1-0.2-2.1-0.7-3-1.4c-0.4-0.3-0.9-0.7-1.2-1.1l-1.7,1.9c2,2.3,4.8,3.5,7.6,3.5c1.4,0,2.9-0.3,4.2-0.9c1.9-0.9,3.6-2.4,4.8-4.3c1.2-2,1.8-4.3,1.8-6.7C24,10.4,23.7,8.8,23.2,7.3z"/></svg>`,
                    'mic': `<svg viewBox="0 0 16 24" preserveAspectRatio="xMidYMid meet"><g><path d="M8,0c1.9,0,3.4,1.4,3.4,3.1v8.6c0,1.7-1.5,3.1-3.4,3.1s-3.4-1.4-3.4-3.1V3.1C4.6,1.4,6.1,0,8,0"/><path d="M8.2,19.4c-0.2,0-0.6,0-0.9,0H7c-3.7-0.4-6.5-3.7-7-7.8l0-0.4c0-0.5,0.3-0.9,0.8-0.9h0.4c0.5,0,0.8,0.4,0.9,0.9l0.1,0.4 c0.5,3.1,3,5.5,5.8,5.5s5.2-2.3,5.8-5.4l0.1-0.4c0-0.5,0.4-0.9,0.9-0.9h0.4c0.4,0,0.8,0.4,0.8,0.9c0,0,0,0.1-0.1,0.6 c-0.6,4.1-3.7,7.3-7.3,7.6L8.2,19.4z"/><path d="M9.1,23.3c0,0.4-0.4,0.7-0.9,0.7H7.8c-0.5,0-0.9-0.3-0.9-0.7V19c0-0.4,0.4-0.7,0.9-0.7h0.5c0.5,0,0.9,0.3,0.9,0.7V23.3z"/></g></svg>`,
                    'mic-off': `<svg viewBox="0 0 24 24"><path d="M24,22l-4.2-4.1c1.4-1.7,2.1-3.7,2.1-5.9h-2.5c0,1.5-0.5,2.9-1.4,4.2l-1.8-1.7c0.5-0.7,0.7-1.6,0.7-2.4V4.8C16.9,2.2,14.7,0,12,0c-0.1,0-0.2,0-0.3,0C9.1,0.2,7.1,2.3,7.1,4.8v0.7L1.7,0.4L0,2.1l22.3,21.6C22.3,23.6,24,22,24,22z M4.6,12H2.1c0,4.9,3.8,8.9,8.7,9.5V24h2.5v-2.5c1-0.1,1.9-0.4,2.8-0.8l-1.9-1.9c-0.7,0.2-1.4,0.3-2.1,0.3C7.9,19.2,4.6,16,4.6,12z"/></svg>`,
                    'play': `<svg viewBox="0 0 18 24" preserveAspectRatio="xMidYMid meet"><path d="M0,2.2c0-2,1.2-2.8,2.6-1.8L17,10.3c1.4,0.9,1.4,2.6,0,3.5L2.6,23.6C1.2,24.5,0,23.8,0,21.8V2.2z"/></svg>`,
                    'pause': `<svg viewBox="0 0 16 24" preserveAspectRatio="xMidYMid meet"><path d="M0,22.7C0,23.3,0.4,24,0.9,24h3.7c0.5,0,0.9-0.5,0.9-1.3V1.3c0-0.7-0.4-1.2-0.9-1.2H0.9C0.5,0,0,0.5,0,1.3 C0,1.3,0,22.7,0,22.7z M11.3,0c-0.5,0-1,0.5-1,1.2v21.5c0,0.7,0.4,1.3,1,1.3H15c0.5,0,1-0.5,1-1.3V1.3c0-0.7-0.4-1.2-1-1.2 C15,0,11.3,0,11.3,0z"/></svg>`,
                    'search': `<svg viewBox="0 0 24 24"><path d="M17.3,15.1h-1.2l-0.4-0.4c1.3-1.5,2.1-3.6,2.1-5.7c0-4.9-4-8.9-9-8.9S0,4,0,8.9s4,8.9,9,8.9c2.1,0,4.3-0.8,5.8-2.1l0.4,0.4 v1.1L22,24l2-2L17.3,15.1z M9,15.1c-3.5,0-6.2-2.8-6.2-6.1S5.6,2.8,9,2.8s6.2,2.8,6.2,6.1S12.5,15.1,9,15.1z"/></svg>`,
                    'smiley': `<svg viewBox="0 0 24 24"><path fill-rule=evenodd clip-rule=evenodd d="M0,12c0,6.6,5.4,12,12,12c6.6,0,12-5.4,12-12c0-6.6-5.4-12-12-12S0,5.4,0,12z M17.6,13.9l0.5-0.1 c0.5,0,0.8,0.4,0.6,0.8c-1.3,2.4-3.8,4.2-6.7,4.2c-2.9,0-5.4-1.8-6.7-4.2c-0.2-0.4,0.1-0.9,0.5-0.8c0.2,0,0.4,0.1,0.7,0.1 c1.4,0.2,3.4,0.4,5.4,0.4C14.1,14.3,16.2,14.1,17.6,13.9z M8.7,11.8c1,0,1.9-1,1.9-2.1c0-1.2-0.9-2.1-1.9-2.1s-1.9,1-1.9,2.1 C6.7,10.8,7.6,11.8,8.7,11.8L8.7,11.8z M17.2,9.7c0,1.1-0.9,2.1-1.9,2.1c-1,0-1.9-1-1.9-2.1c0-1.1,0.9-2.1,1.9-2.1 S17.2,8.6,17.2,9.7z"/></svg>`,
                    'sort-a-z': `<svg viewBox="0 0 24 16" preserveAspectRatio="xMidYMid meet"><path d="M9.3,16h5.3v-2.7H9.3V16z M0,0v2.7h24V0H0z M4,9.3h16V6.7H4V9.3z"/></svg>`,
                    'sort-z-a': {icon: 'sort-a-z', style: 'transform: rotate(180deg);'},
                    'star': `<svg viewBox="0 0 24 24"><path d="M11.4,19.6l-5.6,4.1C5,24.4,4,23.6,4.2,22.5l2-6.7c0.1-0.4,0-0.9-0.4-1.2l-5.5-4.4C-0.4,9.7,0,8.4,1,8.4l6.8-0.1 c0.4,0,0.8-0.3,0.9-0.8L11,0.7c0.3-0.9,1.6-0.9,1.9,0l2.3,6.7c0.1,0.4,0.5,0.7,0.9,0.7L23,8.2c1,0,1.4,1.3,0.6,1.9l-5.5,4.5 c-0.4,0.3-0.5,0.7-0.4,1.2l2,6.9c0.3,0.9-0.8,1.7-1.5,1.2l-5.7-4.2C12.2,19.3,11.8,19.3,11.4,19.6z"/></svg>`,
                    'store': `<svg viewBox="0 0 24 20" preserveAspectRatio="xMidYMid meet"><g><g transform="translate(0 2)"><path d="M19.9-2H4.1C2.8-2,1.7-1.1,1.3,0.1L0.1,4.5c-0.3,1,0.3,2,1.3,2.2c0.2,0,0.3,0.1,0.5,0.1h20.3 C23.2,6.8,24,6,24,5c0-0.2,0-0.3-0.1-0.5l-1.3-4.4C22.3-1.1,21.2-2,19.9-2z M19.9-0.4c0.6,0,1.1,0.4,1.3,0.9l1.3,4.4 c0,0.1,0,0.3-0.2,0.3c0,0,0,0-0.1,0H1.8C1.7,5.3,1.6,5.2,1.6,5c0,0,0,0,0-0.1l1.3-4.4C3-0.1,3.5-0.4,4.1-0.4 C4.1-0.4,19.9-0.4,19.9-0.4z"/><path id="Fill-9_1_" class="st0" d="M23.5,6.1v0.4c0,0.9-1,2.2-2.3,2.2c-1.2,0-2.2-1.2-2.3-2c-0.1,0.8-1.1,2-2.3,2 c-1.2,0-2.2-1.2-2.3-2c-0.1,0.8-1.1,2-2.3,2s-2.2-1.2-2.3-2c-0.1,0.8-1.1,2-2.3,2s-2.2-1.2-2.3-2C5,7.5,4,8.6,2.8,8.6 c-1.3,0-2.3-1.3-2.3-2.2V6.1H23.5z"/><path id="Path-2_1_" class="st0" d="M1.5,11v5.2c0,1,0.8,1.8,1.8,1.8h12.6c1,0,1.8-0.8,1.8-1.8V11c0-0.4-0.4-0.8-0.8-0.8 s-0.8,0.3-0.8,0.8v5.2c0,0.1-0.1,0.3-0.3,0.3H3.3c-0.1,0-0.3-0.1-0.3-0.3V11c0-0.4-0.4-0.8-0.8-0.8S1.5,10.6,1.5,11z M22,17.2V11 c0-0.4-0.4-0.8-0.8-0.8c-0.4,0-0.8,0.3-0.8,0.8v6.2c0,0.4,0.4,0.8,0.8,0.8C21.6,18,22,17.7,22,17.2z"/></g></g></svg>`,
                    'thumbs-down': `<svg viewBox="0 0 24 22" preserveAspectRatio="xMidYMid meet"><path d="M15.3,0H5.5c-0.9,0-1.6,0.6-2,1.3L0.2,9.1C0.1,9.3,0,9.6,0,9.9v2.2c0,1.2,1,2.2,2.2,2.2h6.9L8,19.4v0.3 c0,0.4,0.2,0.9,0.4,1.2L9.6,22l7.2-7.3c0.4-0.4,0.7-1,0.7-1.5v-11C17.5,1,16.5,0,15.3,0z M19.6,0v13.2H24V0H19.6z"/></svg>`,
                    'thumbs-up': {icon: 'thumbs-down', style: 'transform: scaleY(-1);'},
                    'three-dots': `<svg viewBox="0 0 6.1 24" preserveAspectRatio="xMidYMid meet"><path d="M3.1,6c1.7,0,3-1.3,3-3c0-1.7-1.3-3-3-3c-1.7,0-3,1.3-3,3C0.1,4.7,1.4,6,3.1,6L3.1,6z M3.1,9C1.4,9,0,10.3,0,11.9 c0,1.7,1.3,3,2.9,3.1c0,0,0.1,0,0.1,0c1.7,0,3-1.4,2.9-3.1C6,10.3,4.7,9,3.1,9z M3.1,18c-1.7,0-3,1.3-3.1,2.9c0,1.7,1.3,3,2.9,3.1 c0,0,0.1,0,0.1,0c1.7,0,3-1.4,2.9-3.1C6,19.3,4.7,18,3.1,18z"/></svg>`,
                    'undo': '<svg viewBox="0 0 24 19.5" preserveAspectRatio="xMidYMid meet"><path d="M7.5,7.5h9c2.5,0,4.5,2,4.5,4.5s-2,4.5-4.5,4.5H12v3h4.5c4.1,0,7.5-3.4,7.5-7.5s-3.4-7.5-7.5-7.5h-9V0L0,6l7.5,6V7.5z"/></svg>',
                    'redo': '<svg viewBox="0 0 24 19.5" preserveAspectRatio="xMidYMid meet"><path d="M16.5,12L24,6l-7.5-6v4.5h-9C3.4,4.5,0,7.9,0,12s3.4,7.5,7.5,7.5H12v-3H7.5C5,16.5,3,14.5,3,12s2-4.5,4.5-4.5h9V12z"/></svg>',
                    'excel': `<svg viewBox="0 0 20 20"><defs></defs><g><path class="st0" d="M14,17.1h-2.4v-2.4H8.3v2.4H5.8L9.9,20L14,17.1L14,17.1z M18.5,5.5h-4.1c-0.4,0-1-0.2-1.3-0.4 c-0.3-0.2-0.5-0.6-0.5-0.9V1.1l0,0H1.6c0,0-0.1,0-0.1,0c0,0,0,0,0,0.1v14.3c0,0,0,0,0,0.1c0,0,0.1,0,0.1,0h2.9 c-0.2,0.4-0.4,0.7-0.5,1.1H1.2c-0.3,0-0.6-0.1-0.8-0.3C0.1,16.3,0,16.1,0,15.9v-15c0-0.2,0.1-0.4,0.3-0.6C0.6,0.1,0.8,0,1.2,0h12.2 c0,0,0.1,0,0.1,0c0.1,0,0.3,0,0.3,0.1h0c0,0,0,0,0,0l6,4.5C19.9,4.7,20,4.8,20,4.9c0,0,0,0.1,0,0.1c0,4.1,0,6.7,0,10.8 c0,0.2-0.1,0.5-0.3,0.6c-0.2,0.2-0.5,0.3-0.8,0.3h-3.1c-0.1-0.4-0.3-0.8-0.5-1.1h3.1c0,0,0,0,0.1,0c0,0,0.1,0,0.1-0.1 C18.5,11.7,18.5,9.3,18.5,5.5L18.5,5.5z M13.9,4.1V1.3l4.3,3.2h-3.8c-0.1,0-0.3,0-0.4-0.1C14,4.4,13.9,4.2,13.9,4.1L13.9,4.1 L13.9,4.1z"/> <path class="st1" d="M2.2,7.8h1.7L4.8,9l0.9-1.1h1.7L5.8,9.6l1.7,1.9H5.8l-1-1.2l-1,1.2H2.1l1.7-1.9L2.2,7.8L2.2,7.8z M8.1,7.8h1.6 v2.8h2.4v0.9h-4V7.8L8.1,7.8z M12.6,10.3l1.5-0.1c0,0.2,0.1,0.3,0.2,0.4c0.2,0.1,0.4,0.2,0.7,0.2c0.2,0,0.4,0,0.5-0.1 c0.1-0.1,0.2-0.2,0.2-0.3c0-0.1-0.1-0.2-0.2-0.3c-0.1-0.1-0.4-0.1-0.8-0.2c-0.7-0.1-1.2-0.3-1.5-0.4c-0.3-0.2-0.4-0.4-0.4-0.7c0-0.2,0.1-0.4,0.2-0.5c0.1-0.2,0.4-0.3,0.7-0.4c0.3-0.1,0.7-0.1,1.2-0.1c0.6,0,1.1,0.1,1.5,0.3c0.3,0.2,0.5,0.5,0.6,0.8l-1.5,0.1 c0-0.2-0.1-0.3-0.2-0.4c-0.1-0.1-0.3-0.1-0.5-0.1c-0.2,0-0.3,0-0.4,0.1c-0.1,0.1-0.1,0.1-0.1,0.2c0,0.1,0,0.1,0.1,0.2 C14.4,9,14.6,9,14.8,9c0.7,0.1,1.2,0.2,1.5,0.3c0.3,0.1,0.5,0.2,0.6,0.4c0.1,0.2,0.2,0.3,0.2,0.5c0,0.2-0.1,0.5-0.3,0.7 c-0.2,0.2-0.4,0.4-0.8,0.5c-0.3,0.1-0.7,0.2-1.2,0.2c-0.9,0-1.4-0.1-1.8-0.4C12.8,11,12.6,10.7,12.6,10.3L12.6,10.3z"/></g></svg>`,
                    'pdf': `<svg viewBox="0 0 19.2 24" preserveAspectRatio="xMidYMid meet"><path d="M5.12,15.22a2,2,0,0,0-.45,0v1.41a1.83,1.83,0,0,0,.37,0c.57,0,.93-.29.93-.78S5.66,15.22,5.12,15.22Zm4.18,0a2.27,2.27,0,0,0-.48,0v3.14a2.06,2.06,0,0,0,.37,0,1.49,1.49,0,0,0,1.62-1.68A1.37,1.37,0,0,0,9.3,15.23Z"/><path d="M12,0H2.4A2.39,2.39,0,0,0,0,2.4V21.6A2.39,2.39,0,0,0,2.4,24H16.8a2.39,2.39,0,0,0,2.4-2.4V7.2ZM6.6,17a2.22,2.22,0,0,1-1.56.5,2.36,2.36,0,0,1-.37,0v1.71H3.6V14.5a8.88,8.88,0,0,1,1.46-.1,2.35,2.35,0,0,1,1.47.38A1.43,1.43,0,0,1,7,15.89,1.55,1.55,0,0,1,6.6,17Zm4.57,1.62A3.44,3.44,0,0,1,9,19.27a8.71,8.71,0,0,1-1.23-.07V14.5a10.14,10.14,0,0,1,1.46-.1,3.06,3.06,0,0,1,2,.51A2.12,2.12,0,0,1,12,16.72,2.42,2.42,0,0,1,11.17,18.65Zm4.43-3.33H13.76v1.1h1.72v.88H13.76v1.92H12.67V14.44H15.6ZM12,8.4H10.8v-6l6,6Z"/></svg>`,
                    'refresh': `<svg viewBox="0 0 24 24"><path d="M8.9,10.3H5.8l0,0c0.2-1.1,0.5-2.1,1-3.1c0.7-1.4,1.7-2.5,2.8-3.1c0.4-0.2,0.8-0.4,1.2-0.5c0.8-0.2,1.7-0.2,2.6,0 c1.2,0.3,2.3,1.1,3.2,2.3l1.8-2.4c-0.8-1.1-1.8-2-2.8-2.6c-0.5-0.3-1.1-0.5-1.7-0.7c-1.2-0.3-2.4-0.3-3.6,0C9.6,0.4,9.1,0.6,8.5,0.9 c-1.6,0.9-3,2.4-3.9,4.3C4,6.6,3.5,8,3.3,9.6c0,0.2-0.1,0.5-0.1,0.7H0l4.4,6.9C4.4,17.1,8.9,10.3,8.9,10.3z M15.1,13.7h3.2l0,0 c-0.3,2.2-1.3,4.1-2.7,5.4c-0.7,0.6-1.5,1.1-2.3,1.3c-0.8,0.2-1.7,0.2-2.6,0c-0.8-0.2-1.6-0.7-2.3-1.3c-0.3-0.3-0.7-0.7-0.9-1 l-1.8,2.4c0.8,1.1,1.8,2,2.8,2.6c0.5,0.3,1.1,0.5,1.7,0.7c1.2,0.3,2.4,0.3,3.6,0c2.3-0.6,4.3-2.4,5.6-5c0.7-1.3,1.1-2.8,1.3-4.3 c0-0.2,0.1-0.5,0.1-0.7H24l-4.4-6.9C19.6,6.9,15.1,13.7,15.1,13.7z"/></svg>`,
                    'save': `<svg viewBox="0 0 24 24"><path d="M2.7,24h18.7c1.5,0,2.7-1.2,2.7-2.7V6.7L17.3,0H2.7C1.2,0,0,1.2,0,2.7v18.7C0,22.8,1.2,24,2.7,24z M5.3,2.7h5.3v2.7h2.7V2.7H16V8H5.3V2.7z M5.3,13.3h13.3v8H5.3V13.3z"/></svg>`,
                    'printer': `<svg viewBox="0 0 24 24"><path d="M3.6,6H4.8V0H19.2V6h1.2A3.6,3.6,0,0,1,24,9.6h0V18a2.39,2.39,0,0,1-2.38,2.4H19.2V24H4.8V20.4H2.4A2.39,2.39,0,0,1,0,18V9.6A3.6,3.6,0,0,1,3.6,6ZM16.8,2.4H7.2V6h9.6Zm0,19.2V16.8H7.2v4.8ZM3.6,12H8.4V9.6H3.6Z"/></svg>`,
                    'speaker': `<svg viewBox="0 0 24 24"><path d="M16.8,22.9C21,21.1,24,17,24,12s-3-9.1-7.2-10.9v2.4c2.9,1.7,4.8,4.9,4.8,8.5s-1.9,6.8-4.8,8.5V22.9z"/><path d="M16.8,5.9v12.2c1.5-1.3,2.4-3.9,2.4-6.1S18.3,7.3,16.8,5.9z M2.4,18.1h3.2l8.8,5.9V0L5.6,5.9H2.4C1.1,5.9,0,7,0,8.4v7.3C0,17,1.1,18.1,2.4,18.1z"/></svg>`,
                    'delete-filled': `<svg viewBox="0 0 17.5 24" preserveAspectRatio="xMidYMid meet"><path d="M5.5,0L3.3,2.2H0v2.2h17.5V2.2h-3.3L12,0H5.5z M16.4,5.5H1.1v15.8c0,1.5,1.2,2.7,2.7,2.7h9.8c1.5,0,2.7-1.2,2.7-2.7V5.5z"/></svg>`,
                    'info-circle-filled': `<svg viewBox="0 0 24 24"><path d="M12,0C5.4,0,0,5.4,0,12s5.4,12,12,12s12-5.4,12-12S18.6,0,12,0z M13.2,18h-2.4v-7.2h2.4V18z M13.2,8.4h-2.4V6h2.4V8.4z"/></svg>`,
                    'info-square-filled': `<svg viewBox="0 0 24 24"><path d="M0,1.3v21.3C0,23.4,0.6,24,1.3,24h21.3c0.7,0,1.3-0.6,1.3-1.3V1.3C24,0.6,23.4,0,22.7,0H1.3C0.6,0,0,0.6,0,1.3z M10.7,5.3 h2.7V8h-2.7V5.3z M10.7,10.7h2.7v8h-2.7V10.7z"/></svg>`,
                    'eye-open': `<svg viewBox="0 0 24 24" fill="none"><path d="M12 14.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" fill="currentColor"></path><path fill-rule="evenodd" clip-rule="evenodd" d="M6.555 6.31L1 12l5.555 5.69a7.572 7.572 0 0010.89 0L23 12l-5.555-5.69a7.572 7.572 0 00-10.89 0zM17 12a5 5 0 11-10 0 5 5 0 0110 0z" fill="currentColor"></path></svg>`,
                    'eye-closed': `<svg viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M2.94 5.06l16 16 2.12-2.12-2.446-2.447L23 12l-5.555-5.69a7.566 7.566 0 00-9.883-.87L5.06 2.94 2.939 5.06zm6.747 2.506a5 5 0 016.747 6.747L9.687 7.566z" fill="currentColor"></path><path d="M1 12l2.29-2.346 10.198 10.198a7.574 7.574 0 01-6.933-2.162L1 12z" fill="currentColor"></path></svg>`,
                    'message': `<svg viewBox="0 0 24 24"><circle cx="9" cy="9" r="1.8"/><circle cx="15" cy="9" r="1.8"/><path d="M12,0C5.4,0,0,4.3,0,9.6c0,3.5,2.3,6.6,6,8.3V24l6.4-4.8C18.8,19,24,14.8,24,9.6C24,4.3,18.6,0,12,0z M12,16.8h-0.4	l-3.2,2.4v-2.9L7.6,16c-3.2-1.2-5.2-3.7-5.2-6.4c0-4,4.3-7.2,9.6-7.2s9.6,3.2,9.6,7.2S17.3,16.8,12,16.8z"/></svg>`,
                    'phone': `<svg viewBox="0 0 24 24"><path d="M23.3,19l-4.8-3.3c-0.6-0.4-1.5-0.3-1.9,0.2l-1.5,1.7c-0.2,0.2-0.5,0.3-0.8,0.1L14,17.5c-0.9-0.5-2-1.1-4.2-3.4c-2.2-2.3-2.8-3.4-3.3-4.3L6.3,9.5C6.2,9.2,6.2,8.9,6.5,8.7l1.9-1.3C9.1,7,9.3,6.2,8.9,5.6L5.7,0.6C5.3,0,4.4-0.2,3.8,0.1L1.7,1.2C1,1.5,0.5,2.1,0.3,2.8c-0.8,2.6-0.4,7.1,6.2,14c5.3,5.5,9.5,7,12.3,7.1c0.6,0,1.3,0,1.9-0.2c0.7-0.2,1.4-0.6,1.8-1.2l1.3-1.9C24.1,20.3,24,19.4,23.3,19z"/></svg>`,
                    'phone-outgoing': `<svg viewBox="0 0 24 24"><path d="M18.4,3.7l-5.9,5.9l1.9,1.9l5.9-5.9L24,9.2V0h-9.2L18.4,3.7z"/><path d="M17.9,13.9c-0.5-0.5-1.4-0.5-1.9,0.1l-3.2,3.3c-0.8-0.1-2.3-0.6-3.9-2.2c-1.6-1.6-2.1-3.1-2.2-3.9L10,8c0.5-0.5,0.5-1.3,0.1-1.9L5.1,0.7C4.7,0.2,3.8,0.1,3.3,0.6L0.4,3.1C0.2,3.3,0,3.6,0,3.9c0,0.3-0.4,8.2,5.7,14.4c5.3,5.3,12,5.7,13.9,5.7c0.3,0,0.4,0,0.5,0c0.3,0,0.6-0.2,0.9-0.4l2.5-2.9c0.5-0.5,0.4-1.4-0.1-1.9C23.3,18.9,17.9,13.9,17.9,13.9z"/></svg>`,
                    'phone-incoming': {icon: 'phone-outgoing', style: 'transform: scale(-1);'},
                    'wireless-signal': `<svg class="wireless-signal" viewBox="0 0 24 24"><path d="M1.2,17C4.4,17,7,19.6,7,22.8C7,23.4,7.5,24,8.2,24s1.2-0.5,1.2-1.2c0-4.5-3.7-8.1-8.2-8.2c-0.6,0-1.2,0.5-1.2,1.2C0,16.5,0.5,17,1.2,17z"/><path id='wireless-signal-second-bar' d="M1.6,2.3c11,0,20,9,20,20c0,0.6,0.5,1.2,1.2,1.2c0.6,0,1.2-0.5,1.2-1.2C24,10,14,0,1.7,0C1.1,0,0.5,0.5,0.5,1.2C0.4,1.7,0.9,2.3,1.6,2.3z"/><path d="M2.1,9.3c6.9,0,12.6,5.6,12.6,12.6c0,0.6,0.5,1.1,1.1,1.1c0.6,0,1.1-0.5,1.1-1.1C17,13.7,10.3,7,2.1,7C1.5,7,1,7.5,1,8.1S1.5,9.3,2.1,9.3z"/></svg>`,
                    'cog': `<svg viewBox="0 0 24 24"><path d="M0.2,15.9l2.5,4.2c0.3,0.6,1.1,0.8,1.7,0.4l1.7-1c0.7,0.5,1.5,1,2.3,1.3v1.9c0,0.7,0.5,1.2,1.2,1.2h4.9c0.7,0,1.2-0.5,1.2-1.2v-1.9c0.8-0.3,1.6-0.8,2.3-1.3l1.7,1c0.6,0.3,1.3,0.1,1.7-0.4l2.5-4.2c0.3-0.6,0.1-1.3-0.4-1.6l-1.7-1c0.1-0.9,0.1-1.8,0-2.7l1.7-1c0.6-0.3,0.8-1.1,0.4-1.6l-2.5-4.2c-0.3-0.6-1.1-0.8-1.7-0.4l-1.7,1c-0.7-0.5-1.5-1-2.3-1.3V1.2c0-0.7-0.5-1.2-1.2-1.2H9.5C8.9,0,8.3,0.5,8.3,1.2v1.9C7.5,3.5,6.7,3.9,6,4.5l-1.7-1C3.7,3.2,3,3.3,2.6,3.9c0,0,0,0,0,0L0.2,8.1C-0.2,8.6,0,9.4,0.6,9.7l1.7,1c-0.1,0.9-0.1,1.8,0,2.7l-1.7,1C0,14.6-0.2,15.4,0.2,15.9z M12,7.2c2.7,0,4.9,2.2,4.9,4.8	s-2.2,4.8-4.9,4.8S7.1,14.6,7.1,12S9.3,7.2,12,7.2z"/></svg>`,
                    'user-add': `<svg viewBox="0 0 24 20" preserveAspectRatio="xMidYMid meet"><path d="M20.2,5.2h-2.5v3.9h-3.8v2.6h3.8v3.9h2.5v-3.9H24V9.1h-3.8V5.2z M2.5,5.2C2.5,8,4.7,10.4,7.4,10.4c0.1,0,0.2,0,0.2,0c2.7,0.1,5-2.2,5.1-5c0-0.1,0-0.2,0-0.2c0.1-2.8-2.1-5.2-4.9-5.2C7.8,0,7.7,0,7.6,0c-2.7-0.1-5,2.2-5.1,5C2.5,5.1,2.5,5.1,2.5,5.2zM10.2,5.2c0.1,1.4-1,2.5-2.3,2.6c-0.1,0-0.2,0-0.2,0c-1.3,0.1-2.5-1-2.5-2.4c0-0.1,0-0.2,0-0.2C5,3.8,6.1,2.7,7.4,2.6c0.1,0,0.2,0,0.2,0c1.3-0.1,2.5,1,2.5,2.4C10.2,5.1,10.2,5.1,10.2,5.2z M2.5,18.7c0-2.2,1.7-3.9,3.8-3.9h2.5c2.1,0,3.8,1.8,3.8,3.9V20h2.5v-1.3c0-3.6-2.8-6.5-6.4-6.5H6.4c-3.5,0-6.4,2.9-6.4,6.5V20h2.5V18.7z"/></svg>`,
                    'bot': `<svg viewBox="0 0 24 24"><path d="M22.8,10.7V7.1c0-1.3-1.1-2.4-2.4-2.4h-7.2V3.1c0.4-0.3,0.6-0.8,0.6-1.3C13.8,0.8,13,0,12,0s-1.8,0.8-1.8,1.8c0,0.5,0.2,1,0.6,1.3v1.6H3.6c-1.3,0-2.4,1.1-2.4,2.4v3.6l-0.1,0C0.5,10.8,0,11.3,0,12v2.4c0,0.7,0.5,1.2,1.2,1.2v6c0,1.3,1.1,2.4,2.4,2.4h16.8c1.3,0,2.4-1.1,2.4-2.4v-6c0.7,0,1.2-0.5,1.2-1.2V12c0-0.2,0-0.4-0.1-0.5C23.7,10.9,23.1,10.8,22.8,10.7z M6,12c0-1.3,0.8-2.4,1.8-2.4s1.8,1.1,1.8,2.4s-0.8,2.4-1.8,2.4S6,13.3,6,12z M16.8,19.2c-1.2,0-9.6,0-9.6,0v-2.4c0,0,8.4,0,9.6,0C16.8,16.8,16.8,19.2,16.8,19.2z M16.2,14.4c-1,0-1.8-1.1-1.8-2.4s0.8-2.4,1.8-2.4c1,0,1.8,1.1,1.8,2.4S17.2,14.4,16.2,14.4z"/></svg>`,
                    'stop': `<svg viewBox="0 0 24 24"><path d="M0,5.4L0,18c0,3.3,2.7,6,6,6h8.7c2.1,0,4-1.1,5.1-2.8l4-6.4c0.5-0.8,0.3-2-0.6-2.5c-0.8-0.5-2-0.3-2.5,0.6L18,17.2v-13c0-1-0.8-1.8-1.8-1.8s-1.8,0.8-1.8,1.8v6.6h-1.2v-9c0-1-0.8-1.8-1.8-1.8S9.6,0.8,9.6,1.8v9H8.4V3c0-1-0.8-1.8-1.8-1.8S4.8,2,4.8,3v7.8H3.6V5.4c0-1-0.8-1.8-1.8-1.8S0,4.4,0,5.4z"/></svg>`,
                    'spytransfer': `<svg viewBox="0 0 20 24" preserveAspectRatio="xMidYMid meet"><path d="M17,12.6c-0.1,1.5-1.4,2.8-2.9,2.9c-1.8,0.1-3.3-1.3-3.3-3.1c0-0.1,0-0.2,0-0.3C10.6,12.1,10.3,12,10,12c-0.3,0-0.6,0.1-0.8,0.1c0,0.1,0,0.2,0,0.3c0,1.8-1.5,3.2-3.3,3.1c-1.5-0.1-2.8-1.4-2.9-2.9c-0.1-1.8,1.3-3.3,3.1-3.3c1.3,0,2.4,0.8,2.9,1.9c0.3-0.1,0.7-0.2,1.1-0.2c0.4,0,0.7,0.1,1,0.2c0.5-1.1,1.6-1.9,2.9-1.9C15.7,9.3,17.1,10.8,17,12.6zM13.9,10.1c-1.2,0-2.2,1-2.2,2.2s1,2.2,2.2,2.2c1.2,0,2.2-1,2.2-2.2S15.1,10.1,13.9,10.1z M6,10.1c-1.2,0-2.2,1-2.2,2.2s1,2.2,2.2,2.2c1.2,0,2.2-1,2.2-2.2S7.3,10.1,6,10.1z"/><path d="M6.1,0.4c0-0.1,0.1-0.2,0.3-0.2c0.3,0.1,2.5,0.5,2.5,0.5S13.5,0,13.7,0C13.9,0,14,0.1,14,0.2c0,0.1,0.8,2.7,1.5,5H4.5C5.2,3,6,0.5,6.1,0.4z"/><path d="M20,8.6H0c0,0,0,0,0-0.1c0.7-0.3,4.5-2.2,10-2.2C15.6,6.4,19.3,8.2,20,8.6C20,8.6,20,8.6,20,8.6z"/><path d="M14.3,22.4c-6.1,1.9-10.1,0.6-12.4-1.6c-0.2-0.2,0.1-0.4,0.4-0.4c2.9,0.7,6.3,0.2,10.5-1.6l-0.6-1.4c-0.1-0.1,0-0.2,0.1-0.4c0.2-0.3,0.6-0.5,1-0.4l6.3,1.1l0,0c0.3,0.1,0.5,0.3,0.3,0.6l-3.6,5.3c-0.3,0.4-1.1,0.6-1.3,0.2L14.3,22.4z"/></svg>`,
                    'attendedtransfer': `<svg viewBox="0 0 24 24"><path d="M0,16.2V23c0,0,0.1,0.2,0.3,0.3c0.2,0.1,0.6-0.2,0.6-0.2c0.2-0.2,1.6-2,3.8-1.7c0.3,0,0.8,0.1,1.2,0.4c2,0.6,3.9,1.3,5.9,1.9c0.2,0.1,0.7,0.3,1.3,0.3c0.8,0,1.3-0.4,1.5-0.5c2.9-2.2,5.8-4.5,8.7-6.7c0.6-1.1,0.7-1.3,0.3-2c-0.7-1.3-2.2-1-2.3-1l-5.3,3.1c0,0,1.1,1.5,0.1,2.8c-0.7,0.9-1.6,0.8-2.5,0.7c-1.9-0.5-3.8-1.1-5.8-1.6c-0.4-0.1-0.6-0.5-0.5-0.8c0.1-0.4,0.5-0.6,0.9-0.4c1.9,0.6,3.8,1.2,5.7,1.8c0.4,0.1,0.9,0,1.1-0.3c0.4-0.4,0.3-1.2-0.2-1.6c-2.3-0.9-4.7-1.9-7-2.8c-0.4-0.2-0.9-0.3-1.5-0.4c-1-0.1-1.8,0.1-2.3,0.3C2.8,15,1.4,15.6,0,16.2z"/><path d="M14.4,0.7c0-0.6,1-0.9,1.5-0.5L22.5,5c0.4,0.3,0.4,0.7,0,0.9l0,0l-6.5,4.9c-0.4,0.3-0.9,0.3-1.3,0c-0.2-0.1-0.3-0.3-0.3-0.5V8.2c-5.5,0-9.6,1.2-12.5,3.7c-0.3,0.2-0.7,0.1-0.6-0.3c1.5-4.2,5.4-8,13.2-8.9V0.7z"/></svg>`,
                    'callbot': `
                        <svg viewBox="0 0 20 24" preserveAspectRatio="xMidYMid meet">
                            <rect x="1" y="2.3" width="0.8" height="6.5"/>
                            <ellipse cx="7.3" cy="9.7" rx="1.2" ry="1.2"/>
                            <path d="M15.8,3.9H3.6c-0.6,0-1,0.5-1,1v11.3c0,0.6,0.5,1,1,1h12.2c0.6,0,1-0.5,1-1V4.9C16.8,4.3,16.3,3.9,15.8,3.9z M11.9,16.1H7.4v-1.3h4.6V16.1z M15.4,11.7c0,0.5-0.4,1-1,1H5c-0.5,0-1-0.4-1-1V8c0-0.5,0.4-1,1-1h9.6c0.5,0,1,0.4,1,1L15.4,11.7L15.4,11.7z"/>
                            <path d="M1.4,12.9L1.4,12.9c0.8,0,1.3-0.6,1.3-1.3V9.9c0-0.8-0.6-1.3-1.3-1.3l0,0C0.6,8.5,0,9.1,0,9.9v1.7C0,12.3,0.6,12.9,1.4,12.9z"/>
                            <rect x="6.7" y="16.9" width="5.8" height="2.4"/>
                            <path d="M2.6,18.8h14.8c1.4,0,2.6,1.2,2.6,2.6l0,0c0,1.4-1.2,2.6-2.6,2.6H2.6C1.2,24,0,22.8,0,21.4l0,0C0,19.9,1.2,18.8,2.6,18.8z"/>
                            <ellipse cx="1.4" cy="1.3" rx="1.3" ry="1.3"/>
                            <path d="M17.9,12.9L17.9,12.9c0.8,0,1.3-0.6,1.3-1.3V9.9c0-0.8-0.6-1.3-1.3-1.3l0,0c-0.8,0-1.3,0.6-1.3,1.3v1.7C16.6,12.3,17.1,12.9,17.9,12.9z"/>
                            <ellipse cx="12.4" cy="9.7" rx="1.2" ry="1.2"/>
                        </svg>
                    `,
                    'audio-file': `<svg viewBox="0 0 20 24" preserveAspectRatio="xMidYMid meet"><path d="M12.5,0h-10C1.1,0,0,1.1,0,2.4v19.2C0,22.9,1.1,24,2.5,24h15c1.4,0,2.5-1.1,2.5-2.4V7.2L12.5,0z M11.8,22.1l-3.7-2.5H6.7c-0.6,0-1-0.5-1-1v-3.1c0-0.6,0.5-1.1,1-1.1h1.4l3.7-2.5V22.1z M12.8,22.1V11.9c0.9,1.2,1.5,3.3,1.5,5.1C14.3,18.8,13.8,21,12.8,22.1z M11,9V4l5,5H11z"/></svg>`,
                    'full-screen': `<svg viewBox="0 0 24 24"><path d="M2.7,2.7h6.7V0H0v9.3h2.7V2.7z M9.3,21.3H2.7v-6.7H0V24h9.3V21.3z M24,14.7h-2.7v6.7h-6.7V24H24V14.7z M21.3,9.3H24V0h-9.3 v2.7h6.7V9.3z"/></svg>`,
                    'camera': `<svg viewBox="0 0 512 512"><g><path d="M466.8,466.1H45.2C19.6,466.1,0,446.5,0,420.9V149.8c0-25.6,19.6-45.2,45.2-45.2h90.4c3,0,7.5-3,9-4.5L161.1,67 c6-12.1,21.1-21.1,34.6-21.1h120.5c13.6,0,28.6,9,34.6,21.1l16.6,33.1c1.5,3,6,4.5,9,4.5h90.4c25.6,0,45.2,19.6,45.2,45.2v271.1 C512,446.5,492.4,466.1,466.8,466.1z M45.2,134.8c-9,0-15.1,6-15.1,15.1v271.1c0,9,6,15.1,15.1,15.1h421.6c9,0,15.1-6,15.1-15.1 V149.8c0-9-6-15.1-15.1-15.1h-90.4c-13.6,0-28.6-9-34.6-21.1l-16.6-33.1c-1.5-3-6-6-9-6H195.8c-3,0-7.5,3-9,4.5l-16.6,33.1 c-6,13.6-21.1,22.6-34.6,22.6H45.2z"/><path d="M256,405.8c-75.3,0-135.5-60.2-135.5-135.5S180.7,134.8,256,134.8S391.5,195,391.5,270.3S331.3,405.8,256,405.8z M256,164.9c-58.7,0-105.4,46.7-105.4,105.4c0,58.7,46.7,105.4,105.4,105.4S361.4,329,361.4,270.3 C361.4,211.6,314.7,164.9,256,164.9z"/><circle cx="406.6" cy="164.9" r="15.1"/><rect x="60.2" y="74.5" width="60.2" height="15.1"/><path d="M256,210.1V195c-42.2,0-75.3,33.1-75.3,75.3h15.1C195.8,237.2,222.9,210.1,256,210.1z"/></g></svg>`,
                    'filter': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22,3 2,3 10,12.46 10,19 14,21 14,12.46"></polygon></svg>`,
                    'grid': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>`,
                    'grid-u': '⋮⋮⋮',
                    'grid-alt-u': '᎒᎒᎒'
                };
            },

            onMount: (ai) => {
                const setIcon = () => {
                    const attr = ai.getAttr;
                    let size = '';

                    if (attr?.size) { size = attr.size; }
                    if (attr?.s || 's' == attr?.size) { size = '16px'; }
                    if (attr?.m || 'm' == attr?.size) { size = '24px'; }
                    if (attr?.l || 'l' == attr?.size) { size = '32px'; }
                    if (attr?.xl || 'xl' == attr?.size) { size = '40px'; }
                    if (attr['font-size']) { size = attr['font-size']; }
                    if (! size) { size = '1em'; }

                    let unit = size.replace(/\d*\.*\d*/ig, '');
                    let color = attr?.color || 'currentColor';

                    ['neutral', 'info', 'success', 'warning', 'danger', 'accent'].forEach((s) => { if (attr[s]) { color = `var(--${s}-1);` } });

                    if (attr['severity']) { color = `var(--${attr['severity']}-1);`; }

                    let icon = false;
                    let iconStyle = '';
    
                    for (const a in attr) {
                        if (ai.$icons[a]) {
                            icon = ai.$icons[a];

                            if ('object' == typeof icon) {
                                iconStyle = icon.style;
    
                                icon = ai.$icons[icon.icon] || icon.icon;
                            }
    
                            if (/\-u$/.test(a)) { icon = `<span>${icon}</span>`; }
                        }
                    }
    
                    if (! icon) { return create('span'); }
    
                    if (! attr['aria-hidden']) { ai.setAttribute('aria-hidden', true); }
                    if (attr['aria-label']) { ai.setAttribute('title', attr['aria-label']); }
    
                    /*OJO: crear onattribute change para monitorear la propiedad size*/
                    size = size.replace(unit, '');
                    if ('em' != unit && '%' != unit && ! attr['font-size']) { size /= 0.7; }
    
                    let elem = htmlToNode(/*html*/`
                        <style>
                            /*:host vs :host()*/

                            ${commonStyles}

                            :host {
                                --color: ${color};
                                --font-size: ${size}${unit};
                                
                                font-size: var(--font-size);
                                color: var(--color);
                                height: 0.7em;
                                aspect-ratio: 1 / 1;
                                display: inline-flex;
                                justify-content: center;
                                align-items: center;
                            }
                            :host([lowercase]) { font-size: calc(var(--font-size) * 0.7); }/* 70% del font-size */
                            span { ${iconStyle} }
                            svg {
                                position: relative;
                                width: 100%;
                                height: 100%;
                                fill: currentColor;
                                ${iconStyle}
                            }
                            :host([flip]) svg { transform: scale(-1); }
                            :host([horizontal-flip]) svg { transform: scaleX(-1); }
                            :host([vertical-flip]) svg { transform: scaleY(-1); }
                            :host([phone][hungup]) svg { transform: rotate(135deg); }
                            :host([wireless-signal][animate]) svg.wireless-signal path:first-child {
                                animation: fade-in-01 1s ease-in infinite;
                            }
                            :host([wireless-signal][animate]) svg.wireless-signal #wireless-signal-second-bar {
                                animation: fade-in-02 1s ease-in infinite;
                            }
                            :host([wireless-signal][animate]) svg.wireless-signal path:last-child {
                                animation: fade-in-03 1s ease-in infinite;
                            }

                            :host-context(a-button) { pointer-events: none; }/* Evitan que los botones no funcionen al hacer click sobre el ícono */

                            @keyframes fade-in-01 {
                                0% { opacity: 0; }
                                33% { opacity: 1; }
                                100% { opacity: 1; }
                            }
                            @keyframes fade-in-02 {
                                0% { opacity: 0; }
                                66% { opacity: 1; }
                                100% { opacity: 1; }
                            }
                            @keyframes fade-in-03 {
                                0% { opacity: 0; }
                                100% { opacity: 1; }
                            }
                        </style>
                        ${icon}
                    `);
                    
                    ai._root.innerHTML = '';
                    ai._root.appendChild(elem);

                    const svg = ai._root._select('svg');

                    if (svg) {
                        svg.setAttribute('focusale', false);
                        svg.setAttribute('aria-hidden', true);
                    }
                }

                setIcon();

                ai._on('attributechange', (attrName, oldValue, newValue) => { setIcon(); });
            }
        });
    }

    /*
     * Attributes
        font-size=                              "xxx"
        color=                                  "xxx"
        icon-color=                             "xxx"
        disabled=                               sin valor || true || false
        pill | circle | link | transparent | outline | icon
        info | success | warning | danger | accent
        severity=                               info | success | warning | danger | accent (Similar a las opciones anteriores)
        wave=                                   sin valor || true || false
        tabindex=                               0 || -1 (0 por defecto)
        loading=                                sin valor   //Hace que cuando el botón sea deshabilitado, se le ponga un spinner
        busy=                                   sin valor   //Hace que cuando el botón tenga este valor, se le ponga un spinner
        for=                                    ID elemento htmlFor (Hace que el botón se comporte como un LABEL)
        aria-pressed=                           true || false (false por defecto)
        aria-controls=                          'id'        //ID elemento controlado por el botón (Usualmente un a-dialog)
        data-load-url, load-url-onopen, etc.    Lista de atributos propios de a-dialog para la creación de un a-dalog

     * Los botones link y icon se les agrega la propiedad wave por defecto, a menos que se pase wave="false"

     * CSS Variables
        --background-color
        --font-size: 1em;
        --color: var(--white-snow);
        --with-icon-size: 2em;
        --icon-color: var(--neutral-dark);
    */
    if (! customElements.get('a-button')) {
        defineCustomElement({tag: 'a-button', mode: 'closed', innerHTML: /*html*/`
            <style>
                ${commonStyles}

                :host {
                    --bgc-1: var(--neutral-1);
                    --background-color: var(--bgc-1);
                    --font-size: 1em;
                    --color: var(--white-snow);
                    --with-icon-size: 2em;
                    --icon-color: var(--neutral-dark);
                    --wave-color: var(--dark-color-transparent-1);

                    font-size: var(--font-size);
                    color: var(--color);
                    background-color: var(--background-color);
                    border: 1px solid transparent;
                    border-radius: var(--border-radius-1);
                    overflow: hidden;/* Para el efecto wave */
                    display: inline-flex;
                    user-select: none;
                    cursor: pointer;
                }

                :host-context(html.dark) {
                    --icon-color: var(--neutral-1);
                    --wave-color: var(--light-color-transparent-1);
                }

                :host .body {
                    position: relative;
                    width: 100%;
                    text-align: center;
                }
                :host span { color: currentColor; }
                
                :host([pill]) { border-radius: 20rem; }

                :host([outline]) { border-color: var(--background-color); }
                :host([link]) { text-decoration: underline; }
                :host([transparent]),
                :host([outline]),
                :host([link]) {
                    color: var(--background-color);
                    background-color: transparent;
                }
                :host([transparent]) { border-color: transparent; }
                
                :host([circle]) { border-radius: 50%; }
                :host([icon]) { width: var(--with-icon-size); }
                
                /*:host([icon]):not(:host([transparent])) { color: var(--icon-color); }*/

                :host([circle]),
                :host([icon]) {
                    aspect-ratio: 1 / 1;
                    justify-content: center;
                    align-items: center;
                }
                    :host([icon]) .body {
                        font-size: calc(1em / 0.7);
                        display: flex;
                        justify-content: center;
                        align-items: center;
                    }
                    :host(:not([icon])) .body { padding: 0.5rem 0.8rem; }
                    :host([circle]:not([icon])) .body { padding: 0.1rem 0.2rem 0.4rem 0.2rem; }

                :host(:not([disabled]):not([link]):hover),
                :host(:not([disabled])[wave]:not([link]):active) {
                    color: var(--color);/* Para outline y icon */
                    background-color: var(--bgc-2);
                }

                :host(:not([disabled]):not([transparent]):active) { border-color: var(--background-color); }
                :host(:not([disabled]):not([wave]):active),
                :host(:not([disabled]):not([wave]):active:hover) {
                    background-color: var(--bgc-dark);
                }
                :host(:not([disabled]):not([transparent]):focus) { box-shadow: 0 0 0 0.15rem var(--bgc-transparent-1); }

                :host(:not([disabled])[link]:hover),
                :host(:not([disabled])[link]:active),
                :host(:not([disabled])[link]:focus) {
                    text-decoration: none;
                }
                
                .wave-effect {
                    width: 1px;
                    height: 1px;
                    background-color: var(--wave-color);
                    border-radius: 100%;
                    transform: scale(0);
                    animation: wave-animation 1.2s;
                }

                @keyframes wave-animation {
                    100% {
                        opacity: 0;
                        transform: scale(400);
                    }
                }
            </style>
            <div class="body" data-bind="body" part="body"><slot></slot></div>`,
            onCreate: convertToFormElement,
            onMount: (ab) => {
                ab.setAttribute('role', 'button');
                
                let attr = ab.getAttr;
                let dialogUrl = ab?.dataset?.url || ab?.dataset?.loadUrl || ab?.dataset?.loadUrlOnOpen;

                if (attr['tabindex'] == void 0) { ab.setAttribute('tabindex', '0'); }
                if (! attr['aria-pressed']) { ab.setAttribute('aria-pressed', false); }
                if (attr['aria-label']) { ab.setAttribute('title', attr['aria-label']); }
                if (attr['font-size']) { ab.style.setProperty('--font-size', attr['font-size']); }
                if (attr.color) { ab.style.setProperty('--color', attr.color); }
                if (attr['icon-color']) { ab.style.setProperty('--icon-color', attr['icon-color']); }

                if ('false' != attr?.wave) {
                    if (attr.icon || attr.link) {
                        ab.setAttribute('wave', '');
    
                        attr = ab.getAttr;
                    }
                }

                if (attr['for']) {
                    ab.$el.label = create('label', false, {htmlFor: attr['for'], style: {position: 'absolute', visibility: 'hidden'}});

                    ab._insertAfter(ab.$el.label);

                    ab._on('click', (e) => {
                        e.preventDefault();

                        ab.$el.label._event('click');
                    });
                }

                if (attr['loading']) {
                    if (! ab.$el.loadingBox) {
                        ab.$el.loadingBox = create('div', false, {className: 'preloader'});
                    }

                    ab._on('attributechange', (attrName, oldValue, newValue, allMutations) => {
                        if ('busy' != attrName) { return false; }

                        const attr = ab.getAttribute('busy');
                        const isBusy = '' === attr || true === attr;
0
                        if (! isBusy) {
                            ab.$el.loadingBox._remove();
                        } else {
                            ab.$el.body.appendChild(ab.$el.loadingBox);
                        }
                    });
                }

                if (dialogUrl) {
                    let aDialog = create('a-dialog');
                    let attrList = aDialog._attrList;
    
                    for (const a of attrList) {                        
                        let prop = a.split('-').reduce((t, r) => t + r.charAt(0).toUpperCase() + r.slice(1));

                        if (ab.dataset[prop]) {
                            let attrObj = {};
                            attrObj[a] = ab.dataset[prop];

                            aDialog.setAttr = attrObj[a];
    
                            delete ab.dataset[prop];
                        }
                    }
    
                    document.body.appendChild(aDialog);

                    //El id se genera connectedCallback por eso esta línea esta despues del appendChild
                    ab.setAttribute('aria-controls', aDialog.id);

                    ab.$el.target = aDialog;
                }

                const addWaveEffect = (e) => {
                    const attr = ab.getAttr;

                    if (attr.disabled) { return false; }

                    let elementYX = ab.getBoundingClientRect();
        
                    let top = Math.round(e.pageY - elementYX.y - window.scrollY) + 'px';
                    let left = Math.round(e.pageX - elementYX.x - window.scrollX) + 'px';
        
                    const div = create('div', false, {className: 'true-abs-pos wave-effect', style: {
                        top: top,
                        left: left
                    }});
        
                    ab.$el.body.appendChild(div);
                    
                    div._on('animationend', (e) => { div._remove(); }, {once: true});
                    
                    /* Por si animationend no le da chance a accionar debido a que el botón ha sido ocultado por algún evento */
                    setTimeout(() => { div._remove(); }, 1200);
                };
                
                if ('false' != attr?.wave) { ab._on('mousedown', addWaveEffect); }
                
                onDomReady(() => {
                    if (! ab.$el.target && attr['aria-controls']) {
                        let query = '#' + attr['aria-controls'];
                        let rn = ab.getRootNode();

                        if (rn == document) { rn = app.doc; }//El nodo root pudiera ser document por encima del html

                        ab.$el.target = select(query) || rn?._select(query);
                    }

                    if (ab.$el.target) {
                        ab.$el.target.$el.toggler = ab;//Referencia hacia este componente para ser usada por otro componente

                        const adiag = ab.$el.target;

                        if (adiag?.getAttr?.menu) {
                            adiag.$el.window._on('animationend', (e) => {
                                if(adiag.$el.window == e.target && adiag?.getAttr?.menu && 'inactive' == adiag.getAttr?.state) {
                                    adiag.remAttr = ['state'];
                                }
                            });

                            document.addEventListener('click', (e) => {
                                if (e.target !== adiag && e.target !== ab) {
                                    if (adiag?.getAttr?.menu && 'active' == adiag.getAttr?.state) {
                                        adiag._closeDialog({key: 'Escape', preventDefault: () => {}, stopPropagation: () => {}, });
                                    }
                                }
                            });
                        }

                        ab._on('click', (e) => {
                            e.preventDefault();

                            if (adiag?.getAttr?.menu && 'active' == adiag.getAttr?.state) {                                
                                adiag._closeDialog({key: 'Escape', preventDefault: () => {}, stopPropagation: () => {}, });
                                
                                return false;
                            }

                            adiag.setAttribute('state', 'active');//Sólamente activa el elemento, no lo desactiva
                        });
                    }

                    //Si inicia presionado, hacemos click
                    if (ab._isAttributeTrue('aria-pressed')) {
                        ab.ariaPressed = false;//Lo ponemos en false para que el botón cambie el estado con el click programático
                        ab._event('click');
                    }

                    const title = ab.getAttribute('title');

                    if (! ab.getAttribute('aria-label')) {
                        if (! title) {
                            ab.setAttribute('aria-label', ab?.$el?.body?.innerText || '');
                            ab.setAttribute('title', ab?.$el?.body?.innerText || '');
                        } else {
                            ab.setAttribute('aria-label', title);
                        }
                    }
                });
            }
        });
    }

    /*
     * A Hamburger Button
     * Atributos (Sumados a los atributos globales mensionados arriba)
        font-size=                  '30px'
        size=                       '30px'
        color=                      '#000'
        tabindex=                   '0' || '-1'
        disabled=                   sin valor || true || false
        role=                       'button'    //Si no se indica se genera automáticamente
        aria-pressed=               'true'      //Para que inicie presionado
        aria-controls=              'id'        //ID elemento controlado por el botón
        no-motion=                  sin valor || true

     * Propiedades
        a-hamburger.$el.body
        a-hamburger.$el.target
    
     * Variables CSS
        --color
        --font-size
        --size

     * Partes CSS
        body
    */
    if (! customElements.get('a-hamburger')) {
        defineCustomElement({tag: 'a-hamburger', mode: 'closed', innerHTML: /*html*/`
            <style>
                ${commonStyles}

                :host {
                    --bgc-1: var(--text-color-1);
                    --color: var(--bgc-1);
                    --font-size: 1em;
                    --size: 0.7em;

                    font-size: var(--font-size);
                    display: inline-block;
                    width: var(--size);
                    height: var(--size);
                    vertical-align: middle;
                    overflow: visible;
                    user-select: none;
                    cursor: pointer;
                }
                :host() { margin: 10px; }

                .body {
                    position: relative;
                    height: 100%;
                    aspect-ratio: 1 / 1;
                    overflow: visible;
                }

                .body::before {
                    content: "";
                    position: absolute;
                    width: 150%;
                    height: 150%;
                    border-radius: 50%;
                    background-color: transparent;
                    z-index: -1;
                }

                /* Hamburger */
                div,
                div::before,
                div::after {
                    width: 100%;
                    /*
                    * OJO: Tengo que probar con diferentes tamaños a ver si esta línea afecta positivamente la uniformidad de los elementos
                    * Por alguna razón apliqué esta resta de pixeles para corregir una diferencia en altura entre las barras en ciertos tamaños
                    */
                    height: calc(10% - 0.09px);/*Alto de cada barra*/
                    aspect-ratio: 1 / 1;
                    background-color: var(--color);
                    transition: all 0.15s, visibility 0s, overflow-x 0s, overflow-y 0s, z-index 0s;
                }
                div::before,
                div::after {
                    content: "";
                    position: absolute;
                    left: 0;
                }
                div::before {
                    top: 0;
                    transform-origin: top left;
                }
                div::after {
                    bottom: 0;
                    transform-origin: bottom left;
                }

                :host(:not([disabled]):active) .body::before { background-color: var(--accent-color-light); }
                :host([aria-pressed="true"]:not([no-motion])) div { width: 0; }
                :host([aria-pressed="true"]:not([no-motion])) div::before,
                :host([aria-pressed="true"]:not([no-motion])) div::after {
                    width: 131%;
                    left: 6%;
                }
                :host([aria-pressed="true"]:not([no-motion])) div::before { transform: rotate(45deg); }
                :host([aria-pressed="true"]:not([no-motion])) div::after { transform: rotate(-45deg); }
            </style>
            <span class="body d-flex-center" part="body" data-bind="body"><div></div></span>`,
            onCreate: convertToFormElement,
            onMount: (ah) => {
                ah.setAttribute('role', 'button');
                ah.setAttribute('tabindex', '0');

                const attr = ah.getAttr;

                if (! attr['aria-pressed']) { ah.setAttribute('aria-pressed', false); }
                if (attr.tabIndex == void 0) { ah.setAttribute('tabindex', '0'); }
                
                if (attr['font-size']) { ah.style.setProperty('--font-size', attr['font-size']); }
                if (attr.size) { ah.style.setProperty('--size', attr.size); }
                if (attr.color) { ah.style.setProperty('--color', attr.color); }
                
                ah._on('click', (e) => {
                    e.preventDefault();
                        
                    const attr = ah.getAttr;
        
                    if (attr.disabled || '-1' == attr.tabIndex) { return false; }

                    ah._toggleAttribute('aria-pressed', true, false);
                    ah.$el.target._toggleAttribute('aria-expanded', true, false);
                });

                onDomReady(() => {
                    if (attr['aria-controls']) {
                        ah.$el.target = select('#' + attr['aria-controls']);

                        if (ah.$el.target) {
                            ah.$el.target.$el.toggler = ah;//Referencia hacia este componente para ser usada por otro componente
                        }
                    }

                    //Si inicia presionado, hacemos click
                    if (ah._isAttributeTrue('aria-pressed')) {
                        ah.ariaPressed = false;//Lo ponemos en false para que el botón cambie el estado con el click programático
                        ah._event('click');
                    }
                });
            }
        });
    }

    /*
     * A Dark Mode Toggler Button
     * Atributos
        size=           '2em'
        color=          '#000'
        aria-pressed=   'true'      //Para que inicie presionado

     * Variables CSS
        --color
        --font-size
        --icon-size

     * Partes CSS
        body
    */
    if (! customElements.get('dark-mode-toggler')) {
        defineCustomElement({tag: 'dark-mode-toggler', mode: 'closed', innerHTML: /*html*/`
            <style>
                ${commonStyles}
            
                :host {
                    --bgc-1: var(--text-color-1);
                    --color: var(--bgc-1);
                    --font-size: 1em;
                    --icon-size: 0.7em;
                    --color: var(--text-color-1);
                    --half-time: calc(var(--global-transition-time) / 2);

                    font-size: var(--font-size);
                    display: inline-block;
                    vertical-align: middle;
                    user-select: none;
                    cursor: pointer;
                }

                .wrapper {
                    position: relative;
                    display: flex;
                    align-items: center;
                    gap: 0.2em;
                }

                .icons {
                    position: relative;
                    top: 1px;
                    width: var(--icon-size);
                    height: var(--icon-size);
                    overflow: hidden;
                    /* tiene d-flex-center aplicado directamente */
                }

                .text { line-height: var(--icon-size); }

                /* Luna / Sol */
                .moon {
                    width: 100%;
                    height: 100%;
                    background-color: transparent;
                    border-radius: 50%;
                    box-shadow: inset calc(var(--icon-size) / 2.5) calc(var(--icon-size) / -4) var(--color);
                    transition: all 0.75s, visibility 0s, overflow-x 0s, overflow-y 0s, z-index 0s;
                }

                /* Rayos de Sol */
                .beams {
                    position: absolute;
                    width: calc(100% / 15);
                    height: var(--icon-size);
                    opacity: 0;
                    transform: rotate(-90deg);
                    display: flex;
                    flex-direction: column;
                    justify-content: space-between;
                    transition: all 0.75s, visibility 0s, overflow-x 0s, overflow-y 0s, z-index 0s;
                }
                    .beams div {
                        width: 100%;
                        height: 100%;
                        position: absolute;
                        overflow: visible;
                        display: flex;
                        flex-direction: column;
                        justify-content: space-between;
                        transform: rotate(45deg);
                    }
                    .beams::before,
                    .beams::after,
                    .beams div::before,
                    .beams div::after {
                        content: "";
                        width: 100%;
                        height: 15%;
                        border-radius: 15%;
                        background-color: var(--color);
                    }

                :host([aria-pressed="true"]) .moon {
                    width: 50%;
                    height: 50%;
                    box-shadow: inset calc(var(--icon-size) / 1.18) calc(var(--icon-size) / -1.86) var(--color);
                }

                :host([aria-pressed="true"]) .beams {
                    opacity: 1;
                    transform: rotate(0deg);
                }
            </style>
            <div class="wrapper">
                <span class="icons d-flex-center">
                    <div class="moon"></div>
                    <div class="beams"><div><div><div></div></div></div></div>
                </span>
                <span class="text"><slot></slot></div>
            </div>`,

            observableAttributes: ['class', 'tabindex', 'disabled'],

            onCreate: convertToFormElement, 

            onMount: (dm) => {
                dm.setAttribute('role', 'button');
                dm.setAttribute('tabindex', '0');

                const attr = dm.getAttr;

                if (! attr['aria-pressed']) { dm.setAttribute('aria-pressed', false); }
                if (attr.tabIndex == void 0) { dm.setAttribute('tabindex', '0'); }
                
                if (attr['font-size']) { dm.style.setProperty('--font-size', attr['font-size']); }
                if (attr['icon-size']) { dm.style.setProperty('--icon-size', attr['icon-size']); }
                if (attr.color) { dm.style.setProperty('--color', attr.color); }

                dm._on('click', (e) => {
                    e.preventDefault();

                    const attr = dm.getAttr;

                    if (attr.disabled || "-1" == attr.tabIndex) { return false; }

                    if (! app.doc._hasClass('dark')) {
                        app.doc._addClass('dark');

                        return false;
                    }

                    app.doc._removeClass('dark');
                });

                dm._on('classchange', (attrName, oldValue, newValue) => {
                    if (dm._hasClass('dark')) {
                        dm.ariaPressed = true;

                        app.set('colorScheme', 'dark');

                        return false;
                    }

                    dm.ariaPressed = false;

                    app.set('colorScheme', 'light');
                });

                //Si hay mas de un elemento dark-mode-toggler en mismo ducumento, habrá un classchange en el documentor por cada dark-mode-toggler
                app.doc._on('classchange', (attrName, oldValue, newValue) => {
                    if (! app.doc._hasClass('dark')) {
                        dm._removeClass('dark');

                        return false;
                    }

                    dm._addClass('dark');
                });

                if (app.doc._hasClass('dark')) { dm._addClass('dark'); }
            }
        });    
    }

    /*
     * Atributos
        rectagle | circle | pulse 
        info | success | warning | danger | accent
        severity=         //info | success | warning | danger | accent
        size              //Tamaño en cualquier unidad ó s, m, l ó xl
        s                 //Lo mismo que size="s" ó size="16px"
        m                 //Lo mismo que size="m" ó size="24px"
        l                 //Lo mismo que size="l" ó size="32px"
        xl                //Lo mismo que size="xl" ó size="40px"
        font-size         //Alias de size
    */
    if (! customElements.get('a-badge')) {
        defineCustomElement({tag: 'a-badge', mode: 'closed', innerHTML: /*html*/`
            <style>
                ${commonStyles}

                :host {
                    --bgc-1: var(--neutral-1);
                    --background-color: var(--bgc-1);
                    --font-size: 0.75rem;
                    --padding: 0 0.32rem 0.07rem 0.32rem;

                    padding: var(--padding);
                    font-size: var(--font-size);
                    font-weight: bold;
                    color: var(--white-snow);
                    background-color: var(--background-color);
                    border-radius: 15rem;
                    box-shadow: 0 0 0 0 var(--background-color);/* box-shadow invisible por si se aplica el atributo pulse */
                    display: inline-flex;
                    justify-content: center;
                    align-items: center;
                }
                :host([rectangle]) { border-radius: 0; }
                :host([circle]) {
                    min-width: 1rem;
                    aspect-ratio: 1 / 1;
                }
                :host([pulse]) {
                    border: 2px solid var(--white-snow);
                    animation: 1.5s ease infinite running pulse;
                }
                :host([hidden]) { visibility: hidden; }
                @keyframes pulse {
                    0% { box-shadow: 0 0 0 0 inherit; }
                    75% { box-shadow: 0 0 0 0.5rem transparent; }
                    100% { box-shadow: 0 0 0 0 transparent; }
                }
            </style>
            <div class="body" data-bind="body" part="body"><slot></slot></div>`,    
            onMount: (theBadge) => {
                theBadge.setAttr = {'role': 'status'};

                const attr = theBadge.getAttr;
                let size = '';

                if (attr?.size) { size = attr.size; }
                if (attr?.s || 's' == attr?.size) { size = '16px'; }
                if (attr?.m || 'm' == attr?.size) { size = '24px'; }
                if (attr?.l || 'l' == attr?.size) { size = '32px'; }
                if (attr?.xl || 'xl' == attr?.size) { size = '40px'; }
                if (attr['font-size']) { size = attr['font-size']; }

                if (size) {
                    theBadge.style.setProperty('--font-size', size);
                    theBadge.style.setProperty('--padding', '0.5em');
                }
            }
        });
    }

    /*
    Usamos el slot porque podemos sacar el tamaño del contenido, incluso antes del onDomReady

    Hay varias formas de crear los tool-tip
        Esta es una
            <button type="button">
                i
                <tool-tip>
                    <p>Lorem ipsum</p>
                </tool-tip>
            </button>

        Esta es otra
            <a is="tool-tip-link" data-tooltip_content="<p>Lorem ipsum</p>">i</a>

        Esta es otra
            <button is="tool-tip-button" data-tooltip_content="<p>Lorem ipsum</p>" data-tooltip_right_side="true">i</button>

    Atributos (Sumados a los atributos globales mensionados arriba)
        id                  //Si no se especifica, se genera uno
        content
        width
        max-width
        height
        max-height
        color
        bg=color
        arrow-width
        left-side
        right-side
        toggler             //ID del toggler, asignado directamente en el componente, si se omite y _toggler no existe
                            //el componente usará el parentNode como toggler
    
    Propiedades
        tool-tip.$el.wrapper
        tool-tip.$el.body
        tool-tip.$el.arrow
        tool-tip.$el.toggler  //Asignado de forma externa por por un toggler
    */
    if (! customElements.get('tool-tip')) {
        defineCustomElement({tag: 'tool-tip', mode: 'closed', innerHTML: /*html*/`
            <style data-bind="style">
                :host {
                    display: block;

                    /*OJO: Incompleto*/
                    --bgc-1: var(--blue-darker);
                    --background-color: var(--bgc-1);
                }
                
                .tool-tip {
                    position: absolute;
                    min-width: var(--tooltipMinWidth);
                    background-color: var(--tooltipBackgroundColor);
                    border: none;
                    outline: none;
                    overflow: visible;
                    opacity: 0;
                    z-index: -1;
                }

                .tool-tip-top {
                    top: calc(var(--arrowWidth) * -1);
                    transform: translateY(-100%);
                }

                .tool-tip-bottom {
                    bottom: calc(var(--arrowWidth) * -1);
                    transform: translateY(100%);
                }

                .tool-tip-top,
                .tool-tip-bottom {
                    opacity: 1;
                    z-index: 1;
                }

                [data-bind="body"] {
                    padding: 0.5rem;
                    color: var(--tooltipTextColor);
                }

                .tip-arrow {
                    position: absolute;
                    border-width: var(--arrowWidth);
                    border-style: solid;
                    border-color: transparent transparent transparent transparent;
                }
                
                .tool-tip-top .tip-arrow {
                    bottom: 0;
                    border-top-color: var(--tooltipBackgroundColor);
                    transform: translateY(99%);
                }

                .tool-tip-bottom .tip-arrow {
                    top: 0;
                    border-bottom-color: var(--tooltipBackgroundColor);
                    transform: translateY(-99%);
                }
            </style>
            <span data-bind="wrapper" class="tool-tip" tabindex="0">
                <p data-bind="body"><slot></slot></p>
                <div data-bind="arrow" class="tip-arrow"></div>
            </span>`,
            
            onMount: (tt) => {
                tt.setAttr = {'role': 'tooltip'};

                const attr = tt.getAttr;

                if (! attr.id) { tt.id = generateID(12); }

                let minWidth = attr['min-width'] || '340px';
                let color = attr.color || 'var(--white-smoke)';
                let backgroundColor = attr['bg-color'] || 'var(--blue-darker)';
                let arrowWidth = attr['arrow-width'] || '10px';
                let aw = arrowWidth.replace('px', '') * 1;
                let scrollableContainer = select('.body', false, tt, true) || document;
                let containerBounding = {top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0, x: 0, y: 0};
                let ttWidth = 0;
                let ttHalf = 0;
                let togglerWidth = 0;
                let togglerHeight = 0;
                let togglerHalf = 0;

                tt.$el.style._insertBefore(createStyle(`
                    :host {
                        --tooltipMinWidth: ${minWidth};
                        --tooltipTextColor: ${color};
                        --tooltipBackgroundColor: ${backgroundColor};
                        --arrowWidth: ${arrowWidth};
                    }
                `));
                
                if (attr.content) {
                    tt.$el.body.appendChild(htmlToNode(attr.content));
                    tt.removeAttribute('content');
                }

                if (! tt.$el.toggler && attr.toggler) {
                    tt.$el.toggler = tt._select('#' + attr.toggler) || tt._select(attr.toggler);
                }

                if (tt.$el.toggler) {
                    tt.$el.toggler.setAttribute('aria-describedby', tt.id);
                    tt.$el.toggler.style.display = 'inline-block';
                    tt.$el.toggler.style.overflow = 'visible';
                }

                const updatePosition = () => {
                    let togglerBounding = tt.$el.toggler.getBoundingClientRect();

                    if (! ttHalf) { ttHalf = tt.$el.wrapper.offsetWidth / 2; }
                    
                    if (scrollableContainer != document) {
                        containerBounding = scrollableContainer.getBoundingClientRect();
                        containerBounding.width = scrollableContainer.clientWidth;//Ancho sin el scroll, .offsetWidth incluye el scroll
                    } else {
                        containerBounding.width = app.doc.clientWidth || window.innerWidth;
                        containerBounding.height = app.doc.clientHeight || window.innerHeight;
                    }

                    let spaceTop = togglerBounding.top - containerBounding.top;
                    let spaceLeft = togglerBounding.left  - containerBounding.left + togglerHalf;
                    let spaceBottom = containerBounding.height - spaceTop - togglerHeight;
                    let spaceRight = containerBounding.width - spaceLeft;

                    tt.$el.wrapper._removeClass('tool-tip-top tool-tip-bottom');
                    tt.$el.wrapper.style.left = 'auto';
                    tt.$el.wrapper.style.right = 'auto';
                    tt.$el.arrow.style.left = 'auto';
                    tt.$el.arrow.style.right = 'auto';

                    if (spaceLeft > tt.$el.wrapper.offsetWidth / 2 && spaceRight > tt.$el.wrapper.offsetWidth / 2) {
                        tt.$el.wrapper.style.left = `${(ttHalf - togglerHalf) * -1}px`;
                        tt.$el.arrow.style.left = `${ttHalf - aw}px`;
                    } else {
                        let ay = Math.round(togglerHalf - aw < 0 ? 0 : togglerHalf - aw);//La flecha es más ancha que el toggler

                        if (spaceLeft > tt.$el.wrapper.offsetWidth) {
                            tt.$el.wrapper.style.right = 0;
                            tt.$el.arrow.style.right = `${ay}px`;
                        }

                        if (spaceRight > tt.$el.wrapper.offsetWidth) { tt.$el.arrow.style.left = `${ay}px`; }

                        if (spaceLeft < tt.$el.wrapper.offsetWidth && spaceRight < tt.$el.wrapper.offsetWidth) {
                            let y = Math.round((spaceLeft + spaceRight - tt.$el.wrapper.offsetWidth) / 2);

                            tt.$el.wrapper.style.left = `${(spaceLeft - y - togglerHalf) * -1}px`;
                            tt.$el.arrow.style.left = `${spaceLeft - y - aw}px`;
                        }
                    }

                    //Fix para evitar número pixeles no entero en la altura y el translate y no genere un borde semitranspararente
                    let heightTemp = tt.$el.wrapper.getBoundingClientRect().height;

                    if (! tt.$el.wrapper.style.height && heightTemp && heightTemp?.toString().indexOf('.') + 1) {
                        tt.$el.wrapper.style.height = Math.round(heightTemp) + 'px';
                    }

                    if (spaceTop > spaceBottom) {
                        tt.$el.wrapper._addClass('tool-tip-top');
                    } else {
                        tt.$el.wrapper._addClass('tool-tip-bottom');
                    }
                };

                const closeToolTip = (e) => {
                    //if (! tt.$el.toggler.contains(tt)) { return false; }

                    let canClose = false;

                    if (! e.which) {
                        if (e.currentTarget && ! e.currentTarget.contains(e.relatedTarget)) { canClose = true; }
                    } else {
                        if (27 == e.which) {
                            e.preventDefault();
                            e.stopPropagation();
        
                            canClose = true;
                        }
                    }

                    if (canClose) {
                        tt.$el.wrapper._removeOn('focusout', (e) => { closeToolTip(e); });
                        
                        tt.$el.wrapper._removeOn('keyup', (e) => { closeToolTip(e); });
                        
                        if (scrollableContainer != document) {
                            scrollableContainer._removeOn('scroll', updatePosition);
                        } else {
                            document._removeOn('scroll', updatePosition);
                        }
        
                        //OJO: Removemos el elemento con try catch porque keyup y focusout se ejecutan prácticamente al mismo tiempo
                        try {
                            tt.$el.wrapper._removeClass('tool-tip-top tool-tip-bottom');
                            //tt._remove();
                        } catch (err) {
                            console.error('Error: ', err);
                        }
        
                        tt.$el.toggler.href = tt.$el.toggler._href;
                    }
                }

                onDomReady(() => {
                    //Si no hay un toggler especificado, usamos el contenedor del tte
                    if (! tt.$el.toggler) { tt.$el.toggler = tt.parentNode; }

                    if (! ttWidth) {
                        ttWidth = tt.$el.wrapper.offsetWidth;
                        ttHalf = Math.round(ttWidth / 2);
                    }

                    //updatePosition();

                    //tt._remove();

                    if (tt.$el.toggler) {
                        togglerWidth = tt.$el.toggler.offsetWidth;
                        togglerHeight = tt.$el.toggler.offsetHeight;
                        togglerHalf = Math.round(togglerWidth / 2);

                        tt.$el.toggler._on('click', (e) => {
                            e.preventDefault();

                            if (! togglerWidth) {
                                togglerWidth = tt.$el.toggler.offsetWidth;
                                togglerHeight = tt.$el.toggler.offsetHeight;
                                togglerHalf = Math.round(togglerWidth / 2);
                            }

                            //if (tt.$el.toggler.contains(tt)) { return false; }

                            tt.$el.toggler._href = tt.$el.toggler.href;//Backup al href
                            tt.$el.toggler.removeAttribute('href');
                            
                            //tt.$el.toggler.appendChild(tt);

                            if (! ttWidth) {
                                ttWidth = tt.$el.wrapper.offsetWidth;
                                ttHalf = Math.round(ttWidth / 2);
                            }

                            updatePosition();

                            tt.$el.wrapper.focus({preventScroll: true});

                            if (scrollableContainer != document) {
                                scrollableContainer._on('scroll', updatePosition, {passive: true});
                            } else {
                                document._on('scroll', updatePosition, {passive: true});
                            }

                            tt.$el.wrapper._on('keyup', (e) => { closeToolTip(e); });
                            
                            tt.$el.wrapper._on('focusout', (e) => { closeToolTip(e); });
                        });
                    }
                });
            }
        });
    }

    /*
    //Modal
    <a-dialog id="modal"
        close-button 
        transition="swipe-up" 
        drawer="true" 
        position="bottom" 
        width="100%" 
        style-url="./modal.css" 
        style="--background-filter: none;">
    </a-dialog>

    - El modal esta basado en el paradigma de estar sobre un fondo fixed, con el <body> sin scrollbar.
      La diferencia en pixeles del ancho del scrollbar del <body> se reemplaza con padding-right del mismo ancho
    - El modal siempre estará en el centro de la pantalla, a menos que se sobreescriba su ubicación vía parámetros o 
      o actualizando las variables css correspondientes o css añadido
    - El modal por defecto tendrá el scroll en el cuerpo del modal.
    - El la suma del tamaño del scroll del cuerpo mas la cabacera y pie es mayor al del <body>, se habilitará el scroll
      en el wrapper del modal en vez del cuerpo.
    - Si en el cuerpo se detecta algun input que implique la aparición del teclado virtual(Móvil), se habilitará el scroll
      en el wrapper del modal en vez del cuerpo para que la reducción del viewport no reduzca substancialmente el tamaño de la "ventana".
    - La funcionalidad de los dos puntos anteriores se puede activar directamente pasando el parámetro scroll-on-wrapper
    - OJO: No se como funcionaría el modal si el <body> tiene scroll horizontal activado o algun tipo overflow
    - El modal atrapará el foco actual, permitiedo interacción únicamente dentro del modal, al cerrarse el modal, se devolverá el foco 
      al elemento activo previo su apertura.
    - El modal tiene soporte para el teclado, permitiendo ser cerrado con la techa escape, o moviéndonos hasta algun botón de cerrar y
      presionar Enter o la Barra Espaciadora o con el botón Back(Móvil)
    - El modal cumple con los requerimientos de accesibildad Aria mínimo.
    - La mayoría de los valores internos y/o parámetros del modal se pueden pasar por atributos directos o actualizar a traves de las
      variables css con javascript (component.style.setProperty('--property', 'valor')) o pasar hojas de estilo por las vías que aceptan
      todos los componentes de esta librería.
    - OJO: Tengo que hacer una implementación para que con un parámetro que identique un rol se activen todas las opciones relacionada incluidas 
      propiedades como role y aria-*, por ejemplo: snackbar / toast, alert, banner, drawer, etc. debería activar la opciones conocidas y crear un default 
      inicial, ej.: El snackbar es un modal sin el backdrop, es decir, no impide hacer click en los elementos detras de él y se le puede agregar un tiempo 
      para que se cierre solo. Si se elije drawer debo quitar los bordes redondeados y colocar la posicion a la izquierda con swipe-right y una altura de 
      100vh, y sobreescribir con los valores adicionales enviados.

    Atributos (Sumados a los atributos globales mensionados arriba)
        id = 'modal-id' //Si no se especifica, se genera uno
        width = 'xxpx' || 'xx%' || 'xxvr'
        max-width = 'xxpx' || 'xx%' || 'xxvr'
        height = 'xxpx' || 'xx%' || 'xxvh'
        max-height = 'xxpx' || 'xx%' || 'xxvr'
        header-height 'xxpx' || 'xx%' || 'xxvh'
        footer-height 'xxpx' || 'xx%' || 'xxvh'
        margin = 'xxpx' || 'xx%' || 'xxvr'
        border-radius = 'xxpx' || 'xx%'
        top                                                         //OJO: Permitir el uso de un valor aquí y en las demas posiciones
        right
        left
        bottom
        transition = 'grow-from-center' || 'swipe-up' || 'swipe-right' || 'swipe-left' || 'swipe-down' || 'grow-from-right-top' || 
                     'x-grow' || 'y-grow'
        contained                    	                            //Habilita el modal dentro de otro elemento. OJO: No esta bien implementado  
        back-button = solo el atributo                              //Habilita un botón back de cierre
        close-button = solo el atributo                             //Habilita un botón close de cierre
        previous-button = solo el atributo                          //Habilita un botón next
        next-button = solo el atributo                              //Habilita un botón previous
        close-onescape = 'false'                                    //Evita el cierre del modal con la tecla escape
        close-onbackdropclick = 'false'                             //Evita el cierre del modal con el click en el backdrop
        close-onhwback = 'false'                                    //Evita el cierre del modal con clic al back button del browser
        header = 'HTML para el header'
        body = 'HTML para el body'
        footer = 'HTML para el footer'
        scroll-on-wrapper = solo el atributo                        //Si el scroll es necesario, se activará en el wrapper en vez del body de modal
        scroll-on-body = solo el atributo                           //Activa el scroll forzado en el body
        url = 'https://xxx'                                         //Hace fetch al contenido de URL
        load-url = 'https://xxx'                                    //Hace fetch al contenido de URL
        load-url-onopen = 'https://xxx'                             //Hace fetch al contenido de URL cuando el modal se abre
        abort-time = 7000                                           //Tiempo en milisegundos para abortar un fetch
        state = 'active'                                            //Estado inicial de la ventana
        disabled = solo el atributo                                 //Evita que el modal se cierre deshabilitando los botones y las acciones de _closeDialog
        prevent-close = solo el atributo                            //Hace lo mismo que disabled
        menu                                                        //Hace que el modal se comporte como un menú, es decir, no tiene backdrop, ni header, 
                                                                      ni fotter, ni botones de cierre o back y se ubica debajo de algun trigger en el mismo 
                                                                      contenedor (con overflow visible y width y fijo)
        snackbar = solo el atributo || '4.5s'                       //Sin valor defaults a 3s //La colocación de un botón en el modal indica inteacción, 
                                                                      por lo que automaticamente inhabilitarán el tiempo de cierre y barra de progreso
        snackbar-progress = solo el atributo                        //Habilita una barra de progreso que va de mayor a menor equivalente al tiempo restante 
                                                                      para que se cierra el modal
        self-destroy = solo el atributo                             //Elimina el componente del DOM al cerrar ó si es un snackbar, al terminar su tiempo
        drawer = solo el atributo                                   //Quita el border-radius y hace que la ventana cubra el 100% de ancho o alto dependiendo 
                                                                      la posición del modal
    ARIA (OJO: Esa parte se puede hacer dinámicamente con el header y buscando en el contenido o .body)
        aria-describedby="id_descripcion" aria-labelledby="id_titulo_principal"

    SLOTS
        styles
        controls
        before-content
        header
        //Hay un slot sin nombre que sería el default para el contenido y todo lo que se quiera alocal en cuerpo del modal
        footer
        after-content

    CSS
        Variables (var)
            --background-color
            --background-filter
            --window-width
            --window-max-width
            --window-height
            --window-max-height
            --window-margin
            --header-min-height
            --header-height
            --footer-min-height
            --footer-height
            --transition-in
            --transition-out
    
        Partes (part)
            header, body, footer

    Propiedades
        modal.$el.wrapper
        modal.$el.window
        modal.$el.initFocus                                         //Primer foco al abrir el modal
        modal.$el.focusFirst                                        //Primer foco en el focus trap
        modal.$el.focusLast                                         //Último foco en el focus trap
        modal.$el.trapFocusTop                                      //Para atrapar el foco arriba
        modal.$el.trapFocusBottom                                   //Para atrapar el foco abajo
        modal.$el.controls                                          //Div que contiene los controles, para personalizarlos
        modal.$el.closeButton
        modal.$el.backButton
        modal.$el.previousButton                                    //Para slides dentro del modal
        modal.$el.nextButton                                        //Para slides dentro del modal
        modal.$el.header
        modal.$el.body
        modal.$el.footer
        modal.$el.toggler                                           //Botón externo que activa el modal, el botón puede auto asignarse
        modal.$el.snackbarProgress
        modal.$el.previousFocus                                     //Almacena el elemento que tiene el foco antes de abrir el modal

        elem.dataset.autofocus                                      //Si algun elemento dentro del modal tiene el dataset autofocus, 
                                                                      este se convertirá en modal.$el.initFocus

    Métodos
        modal._onOpen
        modal._onClose
        modal._loadUrl
        modal._show
        modal._hide
                
        Privados
            modal._closeDialog
            modal._setFocus
            modal._trapFocus                                        //Con caret browsing activo y dev tools abierta, PageUp vence el trapFocus
            modal._setCursor
            modal._arrowKeysDownFnc                                 //Detecta las flechas para atrapar el foco
    */
    if (! customElements.get('a-dialog')) {
        defineCustomElement({tag: 'a-dialog', mode: 'closed', innerHTML: /*html*/`
            <style>
                ${commonStyles}

                :host {
                    --bgc-1: var(--bg-color-1);
                    --background-color: var(--bgc-1);
                    
                    --window-width: auto;
                    --window-max-width: auto;
                    --window-height: auto;
                    --window-max-height: calc(100vh - 2rem);
                    --window-margin: 1rem;
                    --corner-gradient: linear-gradient(90deg, var(--background-color) 0%, var(--background-color) 40%, transparent 100%);
                    --background-filter: blur(5px);
                    --body-padding-left: 1rem;
                    --body-padding-right: 1rem;
                    --header-min-height: 40px;
                    --header-height: auto;
                    --footer-min-height: 40px;
                    --footer-height: auto;
                    --transition-in: grow-from-center;
                    --transition-out: grow-from-center-reverse;
                }

                :host([neutral]) { --bgc-1: var(--neutral-1); }
                
                :host([severity]) *,
                :host([info]) *,
                :host([neutral]) *,
                :host([success]) *,
                :host([warning]) *,
                :host([danger]) *,
                :host([accent]) * {
                    color: var(--white-snow);
                }

                .trap-focus {
                    position: fixed;
                    height: 0;
                    overflow: hidden;
                }
                    .trap-focus:focus-visible { outline: none; }
                .trap-focus-top { top: 0; }
                .trap-focus-bottom { bottom: 0; }

                .wrapper {
                    /* tiene aplicado true-fixed-pos directamente */
                    overflow: hidden;
                    z-index: 99999999999;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                }

                .backdrop {
                    /* tiene aplicado true-fixed-pos directamente */
                    background-color: hsla(0, 0%, 0%, 0.7);
                    backdrop-filter: var(--background-filter);
                    z-index: 99999998;
                }

                .window {
                    position: relative;
                    width: var(--window-width);
                    max-width: var(--window-max-width);
                    overflow: hidden;/* Para ocultar los degradados de .header::before y header::after */
                    background-color: var(--background-color);
                    box-shadow: var(--shadow-1);
                    /*
                     * Cuando el body del modal tiene el scroll activo y sa hace tab el contenido se rueda hacia arriba y el overflow: hidden
                     * lo oculta, perdiéndose parte de la cabacera, las seguientes dos líneas ayudan a mantener el contenido en su lugar
                     */
                    display: flex;
                    flex-direction: column;
                }
                    .window::before,
                    .window::after {
                        /* Tiene aplicado content-before content-after directamente */
                        width: 80px;
                        min-height: var(--header-min-height);
                        height: var(--header-height);
                        background-image: var(--corner-gradient);
                    }
                    .window::before { z-index: 1; }
                    .window::after {
                        left: auto;
                        right: 0;
                        transform: rotate(180deg);
                    }
                
                .controls a-button {
                    position: absolute;
                    top: 3px;
                    font-size: 14px;
                    z-index: 2;
                }
                    /*.controls a-button:not(a-button:hover):not(a-button:active) { color: var(--text-color-1); }*/
                    [data-bind="backButton"],
                    [data-bind="previousButton"] {
                        left: 3px;
                    }
                    [data-bind="closeButton"],
                    [data-bind="nextButton"] {
                        right: 3px;
                    }

                .content, .header, .body, .footer { position: relative; }

                .content {
                    display: flex;
                    flex-direction: column;
                }

                .header {
                    /* Tiene aplicado d-flex-center directamente */
                    min-height: var(--header-min-height);
                    height: var(--header-height);
                    white-space: nowrap;
                    overflow: hidden;
                }

                .footer {
                    /* Tiene aplicado d-flex-center directamente */
                    min-height: var(--footer-min-height);
                    height: var(--footer-height);
                }
                    
                .body { padding: 1rem; }

                :host([contained]) .wrapper,
                :host([contained]) .backdrop {
                    position: absolute;
                }
                :host([scroll-on-wrapper]) .wrapper {
                    overflow-x: hidden;
                    overflow-y: auto;
                    overscroll-behavior: contain;
                    align-items: flex-start;
                }
                :host([top]) .wrapper { align-items: flex-start; }
                :host([right]) .wrapper { justify-content: flex-end; }
                :host([left]) .wrapper { justify-content: flex-start; }
                :host([bottom]) .wrapper { align-items: flex-end; }
                :host([snackbar][back-button]),
                :host([snackbar][previous-button]) {
                    --body-padding-left: 3rem;
                }
                :host([snackbar][close-button]),
                :host([snackbar][next-button]) {
                    --body-padding-right: 3rem;
                }
                :host-context(body[class^="A-DIALOG"]) .wrapper:is(:host([snackbar]) .wrapper) {
                    padding-right: var(--scrollbar-width, 0px);
                }
                :host([snackbar]) .wrapper {
                    height: 0px;
                    overflow: visible;
                    top: 50%;
                }
                :host([menu]) .wrapper {
                    position: relative;
                    display: block;
                    height: 0px;
                    padding-top: 10px;
                    overflow: visible;
                    clip-path: inset(0 -100vw -100vw -100vw);
                }
                :host([snackbar][top]) .wrapper  { top: 0; }
                :host([snackbar][bottom]) .wrapper { top: 100%; }
                    :host([snackbar]) .wrapper .window::before,
                    :host([snackbar]) .wrapper .window::after,
                    :host([snackbar]) .wrapper :is(.header, .footer) { display: none; }
                    :host([snackbar]) .wrapper .body { padding: 1rem var(--body-padding-right) 1rem var(--body-padding-left); }
                :host([scroll-on-wrapper]) .window { margin: var(--window-margin); }

                .window:not(:host([drawer]) .window) { border-radius: var(--border-radius-2); }/* Drawer */
                    [data-bind="backButton"]:not(:host([back-button]) [data-bind="backButton"]),
                    [data-bind="closeButton"]:not(:host([close-button]) [data-bind="closeButton"]),
                    [data-bind="previousButton"]:not(:host([previous-button]) [data-bind="previousButton"]),
                    [data-bind="nextButton"]:not(:host([next-button]) [data-bind="nextButton"]) {
                        display: none;
                    }
                .content:not(:host([scroll-on-wrapper]) .content) {
                    height: var(--window-height);
                    max-height: var(--window-max-height);
                }
                .body:not(:host([scroll-on-wrapper]) .body) {
                    overflow-x: hidden;
                    overflow-y: auto;
                    overscroll-behavior: contain;
                }
                
                :host(:not([state])) { display: none; }

                :host([state="active"]) .backdrop { animation: fade-in 0.15s; }
                :host([state="active"]) .window { animation: fade-in-delayed 0.30s, var(--transition-in) 0.20s 0.10S var(--elastic-ease); }
                :host([state="active"][snackbar]) .window,
                :host([state="active"][menu]) .window {
                    animation: fade-in 0.25s, var(--transition-in) 0.25s var(--elastic-ease);
                }

                :host([state="inactive"]) .backdrop { animation: fade-out 0.15s; }
                :host([state="inactive"]) .window { animation: fade-out 0.15s, var(--transition-out) 0.15s var(--elastic-ease); }
                /*:host([state="inactive"][snackbar]) .window,
                :host([state="inactive"][menu]) .window {
                    animation: fade-out 0.25s, var(--transition-out) 0.25s var(--elastic-ease);
                }*/

                @keyframes fade-in-delayed {
                    0% { opacity: 0; }
                    50% { opacity: 0; }
                    100% { opacity: 1; }
                }
                @keyframes fade-in-toast {
                    from {
                        opacity: 0;
                        transform: translateY(-4rem);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
                @keyframes fade-out-toast {
                    from { opacity: 1; }
                    to {
                        opacity: 0;
                        transform: translateY(-4rem);
                    }
                }
            </style>
            <slot name="styles"></slot>
            <!-- Uso el &nbsp; como contenido para que el Caret Browsing. Este es único modo en que las flechas generan un FocusEvent. -->
            <div class="trap-focus trap-focus-top" data-bind="trapFocusTop" data-focus="_trapFocus">&nbsp;</div>
            <div class="wrapper true-fixed-pos" data-bind="wrapper">
                <div class="window content-before content-after" data-bind="window">
                    <div class="controls" data-bind="controls">
                        <slot name="controls"></slot>
                        <a-button accent circle icon transparent aria-label="Back" data-bind="backButton" data-click="_closeDialog">
                            <an-icon chevron-left></an-icon>
                        </a-button>
                        <a-button accent circle icon transparent aria-label="Close" data-bind="closeButton" data-click="_closeDialog">
                            <an-icon x></an-icon>
                        </a-button>
                        <a-button accent circle icon transparent aria-label="Previous" data-bind="previousButton" data-click="_previousItem">
                            <an-icon chevron-left></an-icon>
                        </a-button>
                        <a-button accent circle icon transparent aria-label="Next" data-bind="nextButton" data-click="_nextItem">
                            <an-icon chevron-right></an-icon>
                        </a-button>
                    </div>
                    <slot name="before-content"></slot>
                    <div class="content" data-bind="content">
                        <header class="header d-flex-center" data-bind="header" part="header"><slot name="header"></slot></header>
                        <div class="body" data-bind="body" part="body"><slot></slot></div>
                        <footer class="footer d-flex-center" data-bind="footer" part="footer"><slot name="footer"></slot></footer>
                    </div>
                    <slot name="after-content"></slot>
                </div>
            </div>
            <div class="backdrop true-fixed-pos" data-bind="backdrop" data-click="_closeDialog" role="backdrop"></div>
            <div class="trap-focus trap-focus-bottom" data-bind="trapFocusBottom" data-focus="_trapFocus">&nbsp;</div>`,

            observableAttributes: ['state'],

            onCreate: (db) => {
                //OJO: Hay que actualizar esta lista de atributos, esta es usada para que a-button filtre los atributos permitidos en este componente y los inicie en modal nuevo
                db._attrList = [
                    'id', 'width', 'max-width', 'height', 'max-height', 'header-height', 'footer-height', 'margin', 'border-radius', 'top', 'right', 
                    'left', 'bottom', 'transition', 'snackbar', 'menu', 'drawer', 'contained', 'back-button',  'close-button', 'previous-button', 
                    'next-button', 'close-onescape', 'close-onbackdropclick', 'close-onhwback', 'header', 'body', 'footer', 
                    'scroll-on-wrapper',  'scroll-on-body',  'load-url', 'load-url-onopen', 'abort-time', 'state', 'disabled', 'prevent-close'
                ];
            }, 

            onMount: (db) => {
                /*OJO: Investigar los roles y aria del snackbar y agregarlos según sea necesario*/
                db.setAttr = {'role': 'modal'};
                db.setAttr = {'aria-modal': true};
                db.setAttr = {'aria-label': 'Modal'};//OJO: Este aria pudiera ser innesario
                
                const attr = db.getAttr;
                
                if (! attr.id) { db.id = generateID(12); }//Generamos un ID que pueda ser usado en algun estado push o pull

                let bodyFixedClass = ! attr.snackbar && ! attr.menu && ! attr.contained ? `${db.tagName}_${db.id}-active` : false;
                let bodyFixedStyle = false;
                let virtualKeyboardIsPossible = false;//Aloja la detección de posible teclado virtual que puediera reducir el viewport
                let arrowkeysdownListener = null;//Aquí guardardarémos el resultado del eventListener de las teclas de flecha para poder removerlos luego
                let escapedownListener = null;//Aquí guardardarémos el resultado del eventListener de la tecla escape para poder removerlo luego

                db._translation = {
                    iso: {'en': {
                        name: 'English',
                        dir: 'ltr',
                        back: 'Back',
                        close: 'Close',
                        previous: 'Previous',
                        next: 'Next'
                    }},

                    iso: {'es': {
                        name: 'Español',
                        dir: 'ltr',
                        back: 'Cerrar',
                        close: 'Cerrar',
                        previous: 'Cerrar',
                        next: 'Cerrar'
                    }}
                };

                if (attr?.snackbar || attr?.menu) {
                    if (db.$el.backdrop) { db.$el.backdrop._remove(); }
                }
                
                if (attr.snackbar) {
                    ///OJO: Revisar esta línea, creo que es mejor crear una variable nueva con este valor y dejar el atributo como esta
                    if (/^\d+(\.?\d+)?(s){1}$/.test(attr.snackbar)) { db.setAttr = {snackbar: parseFloat(attr.snackbar.replace('s', '') * 1000)} }
                    
                    db.setAttr = {'role': 'alert'};
                }

                if (attr.width) { db.style.setProperty('--window-width', attr.width); }
                if (attr['max-width']) { db.style.setProperty('--window-max-width', attr['max-width']); }
                if (attr.height) { db.style.setProperty('--window-height', attr.height); }//OJO: Si es un snackbar usar valores que no sean porcentaje
                if (attr['max-height']) { db.style.setProperty('--window-max-height', attr['max-height']); }

                if (attr.margin) { db.style.setProperty('--window-margin', attr.margin); }

                if (attr.transition) {
                    db.style.setProperty('--transition-in', attr.transition);
                    db.style.setProperty('--transition-out', attr.transition + '-reverse');
                }

                if (attr['max-height']) { db.style.setProperty('--header-height', attr['max-height']); }
                if (attr['footer-height']) { db.style.setProperty('--footer-height', attr['footer-height']); }

                if (attr.header) { db.$el.header.appendChild(htmlToNode(attr.header)); }
                
                if (attr.body) { db.$el.body.appendChild(htmlToNode(attr.body)); }

                if (attr.footer) { db.$el.footer.appendChild(htmlToNode(attr.footer)); }

                db.remAttr = ['header', 'body', 'footer'];

                if (! attr['back-button']) { db.$el.backButton._remove(); };
                if (! attr['close-button']) { db.$el.closeButton._remove(); }
                if (! attr['previous-button']) { db.$el.previousButton._remove(); };
                if (! attr['next-button']) { db.$el.nextButton._remove(); }
                if (! attr['next-button']) { db.$el.nextButton._remove(); }

                //Si el header no tiene hijos aparte del slot, lo removemos
                if (! attr['back-button'] && ! attr['close-button'] && ! attr['previous-button'] && ! attr['next-button'] && ! db.$el.header.firstElementChild?.nextElementSibling) {
                    db.$el.header._remove();
                    db.$el.header = {firstElementChild: false}//Esto lo hacemos para setCursor no intente ejecutarse en el header
                    //El window::before y window::after utilizan este tamaño para el degradaso de las esquinas, necesitamos asegurarnos de que estas esquinas no oculten contenido
                    db.style.setProperty('--header-min-height', '0px');
                };

                //Si el footer no tiene hijos aparte del slot, lo removemos
                if (! db.$el.footer.firstElementChild?.nextElementSibling) {
                    db.$el.footer._remove();
                    db.$el.header = {firstElementChild: false}//Esto lo hacemos para setCursor no intente ejecutarse en el footer
                }

                db._loadUrl = async (url) => {
                    db.$el.body.textContent = 'Loading content...';

                    const result = await loadFileContent(url, 'html/text', attr['abort-time'] || false);

                    if (! result.ok) {
                        console.error('Error: ', result?.message || result);
    
                        db.$el.body.innerHTML = /*html*/`
                            <h5 class="error-text-color">No se pudo cargar el contenido<h5><p>Es posible que se encuentre offline</p>
                        `;
                    } else {
                        db.$el.body.innerHTML = '';
                        db.$el.body.appendChild(htmlToNode(result.data));
    
                        //Llamamos este método proveniente del defineCustomElement, por si hay elementos nuevos con la propiedad data-bind
                        db._bindInteractiveElements();
                        db._setFocus();
                    }
                }

                db._closeDialog = function(e, id) {
                    if (db._isAttributeTrue('disabled') || db._isAttributeTrue('prevent-close')) { return false; }

                    const attr = db.getAttr;
                    const elem = e?.currentTarget || {};
                    const backdrop = db.$el?.backdrop == elem;
                    const btn = ('_closeDialog' == elem?.dataset?.click || 'BUTTON' == elem?.tagName || 'A-BUTTON' == elem?.tagName) && ! backdrop;
                    const escapeKey = (27 == e?.which || e?.detail?.escape || 'Escape' == e?.key) && 'false' !== attr['close-onescape'];
                    const hardwareBtn = e?.state && id && id == db.id;

                    //Los snackbar no generan history por eso hacemos esta comprobación.
                    //Si no es el modal correspondiente (cuando hay varios modales que no son activos) evitamos el cierre
                    if (! attr.snackbar && db != app.dialogs[app.dialogs.length - 1]) { return false; }

                    if (escapeKey || backdrop || btn || hardwareBtn) {
                        if (! hardwareBtn) {
                            e.preventDefault();
                            e.stopPropagation();
                        } else {
                            //Si se hizo click en el back button, pero existe el atributo close-onhwback y esta seteado en 'false'
                            if ('false' === attr['close-onhwback']) {
                                app.pullState(db.id);//Borramos la referencia que el onpopstate ejecutó y la creamos otra vez
                                app.pushState(db.id, db._closeDialog);

                                return false;
                            }
                        }

                        //Si se hizo clic en el backdrop pero existe el atributo close-onbackdropclick y esta seteado en 'false'
                        if (backdrop && 'false' === attr['close-onbackdropclick']) { return false; }

                        db.setAttr = {'state': 'inactive'};

                        return false;
                    }

                    //OJO: No requerdo que estaba testeando, posiblemente el trapfocus tenga algun problema cuando se activa el carret browsing
                    console.log(db.$el.focusFirst);

                    //OJO: Si el modal no se cerró (Posible close-onbackdropclick="false"), regresamos el foco al primer elemento disponible
                    //if (db.$el.focusFirst) { db.$el.focusFirst.focus(); }
                }

                db._setFocus = () => {
                    const attr = db.getAttr;

                    //Si el modal no esta activo o es un snackbar, no hay necesidad de activar el foco
                    if (! attr.state || 'active' != attr.state || attr.snackbar) { return false; }

                    if (! db.$el.initFocus) {
                        const focusableInContent = selectFocusable(db.$el.content);

                        if (! focusableInContent.length) {
                            if (! attr['scroll-on-wrapper']) { db.$el.body.tabIndex = 0; } else { db.$el.wrapper.tabIndex = 0; }
                        } else {
                            //Quitamos esta propiedades por si hubo algun cambio en el contenido del modal
                            db.$el.body.removeAttribute('tabindex');
                            db.$el.wrapper.removeAttribute('tabindex');

                            //Reseteamos esta variable por si algo ha cambiado en el contenido del modal
                            virtualKeyboardIsPossible = false;

                            for (let f of focusableInContent) {
                                //Hacemos que el primer elemento focusable en el contenido sea el foco inicial
                                if (! db.$el.initFocus) { db.$el.initFocus = f; }

                                //Si el usuario definió un elemento con data-autofocus, este será el foco inicial
                                if (f.dataset.hasOwnProperty('autofocus')) { db.$el.initFocus = f; }

                                if (isTextBox(f)) { virtualKeyboardIsPossible = true; }
                            }
                        }
                    }

                    //Deshabilito estos dos para que no sean encontrados por selectFocusable
                    db.$el.trapFocusTop.removeAttribute('tabindex');
                    db.$el.trapFocusBottom.removeAttribute('tabindex');

                    const focusable = selectFocusable(db);

                    //Intentabus encontrar el primer y último elemento que acepte focus
                    if (focusable.length) {
                        /* Si hay un solo elemento, ambos valores apuntarán al mismo objeto */
                        db.$el.focusFirst = focusable[0];
                        db.$el.focusLast = focusable[focusable.length - 1];
                    }

                    //Si alguno de estos elementos tiene scroll, lo colocamos al inicio
                    db.$el.body.scrollTop = 0; 
                    db.$el.wrapper.scrollTop = 0;
                    db._setCursor();

                    //OJO: El initFocus falla cuando hay multiples modales abiertos
                    //OJO: Cuando entro con click a algun control del modal, el foco se ubica en  el botón de cerrar
                    //OJO: Varios modales activos al mismo tiempo traen problemas para el trapFocus);
                    if (db.$el.initFocus) { db.$el.initFocus.focus(); } else if (db.$el.focusFirst) { db.$el.focusFirst.focus(); }

                    //Volvemos a activar los capturadores del cursor
                    db.$el.trapFocusTop.tabIndex = 0;
                    db.$el.trapFocusBottom.tabIndex = 0;
                }

                /* Atrapar el foco */
                /*
                 * Si me paso del prompt de la console al Window con la tecla tab, este genera un evento Event focus en Window que busca 
                 * el primer elemento al que se le pueda pasar el foco en el <body>, este a su vez genera otro evento FocusEvent focus 
                 * capturado por Window y ejecuta esta función, la cual pasa el foco a un elemento del modal, este foco a su vez genera
                 * otro evento FocusEvent focus que el Window captura y ejecuta esta función, pero como el foco ya esta en el modal, no 
                 * realiza ninguna acción
                */
                db._trapFocus = (e) => {
                    //e.preventDefault();//OJO: No se si esto es necesario
                    //e.stopPropagation();//OJO: No se si esto es necesario
                    
                    //El trapFocus debe funcionar solo para el modal activo que esté mas arriba
                    if (db != app.dialogs[app.dialogs.length - 1]) { return false; }
                    
                    const attr = db.getAttr;
                    const elem = e?.target;
                    const evtElem = e?.currentTarget;

                    /*
                     * Cuando e?.target es window, el FocusEvent aun no se ha efectuado, sino un Event, luego viene el FocusEvent hacia
                     * el primer elemento que tenga foco. Si no hacemos caso omiso al Event, se ejecutarían 4 eventos consecutivos:
                     * 1. Event (en la ventana)
                     * 2. FocusEvent hacia el modal
                     * 3. FocusEvent hacia el primer elemento con foco en el documento, producto del Event en el 1er Event
                     * 4. FocusEvent hacia el modal producto del evento 3
                    */
                    if (elem == window || elem == db) { return false; }

                    if (attr.contained && 'A-DIALOG' == elem?.tagName) { return false; }//Posible modal dentro de modal

                    /*
                     * OJO: Posible Bug: Si hay un control input type="password" en el documento, window reporta este como e.target
                     * independientemente de si hay otros controles antes que este o no, inclusive si el foco o cursor auno no 
                     * han llegado a la ubicación de este
                    */

                    if (evtElem == db.$el.trapFocusTop) {
                        db.$el.focusLast.focus();

                        db._setCursor(true);
                    }
                    if (evtElem == db.$el.trapFocusBottom || (evtElem == window && elem != db)) {
                        db.$el.body.scrollTop = 0; 
                        db.$el.wrapper.scrollTop = 0;
                        db.$el.focusFirst.focus();

                        db._setCursor();
                    }
                }

                //Con el Caret Browsing activo, ubicamos el cursor en el elemento enfocado
                db._setCursor = (bottom = false) => {
                    const range = new Range();
                    const selection = document.getSelection();
                    const elem = ! bottom ? db.$el.header?.firstElementChild || db.$el.body?.firstElementChild : db.$el.footer?.lastElementChild || db.$el.body?.lastElementChild;

                    range.setStart(elem, ! bottom ? 0 : elem.length - 1);
                    range.setEnd(elem, ! bottom ? 0 : elem.length - 1);
                    selection.removeAllRanges();
                    selection.addRange(range);
                }

                //Si las flechas movieron el cursor hacia un elemento fuera del modal, devolvemos el foco adentro del modal
                db._arrowKeysDownFnc = (e) => { if (e.target != db) { db._trapFocus(e); } }

                db._show = () => { db.setAttr = {state: 'active'}; }
                db._hide = () => { db.setAttr = {state: 'inactive'}; }

                /*
                * OJO: Este bloque de comentario debe ser corregido para reflejar como funciona realmente el modal
                * Orden eventos:
                * 1. Los elementos wrapper, backButton, closeButton, nextButton, previousButton, trapFocusTop y trapFocusBottom 
                *    toman sus eventos durante la creación del modal
                * 2. Se configuran todos los parámetros, como tamaño, posición, etc.
                * 3. Si se activa el modal
                *    3.1. Se guarda el elemento que tiene el foco actual
                *    3.2. Se añaden eventos a los siguientes elementos: 
                *       Back button del navegador o hardware -> _closeDialog, window(tecla Escape -> _closeDialog , tecla Tab -> _trapFocus y Flechas -> _trapFocus)
                *       Si es un Toast, a la ventana del modal se la añade mouseenter evitar el cierre y mouseleave para continuar con el timer
                *    3.3. Se determina si el modal lleva scroll y si se va a activar en el cuerpo
                *       o en el wrapper y se aplican las correcciones necesarias
                *    3.5. Se crea el estilo y se aplica la clase al <body> que ocultará el scroll y añadirá el padding-right equivalente al ancho del scroll si es necesario     (Evita reflow)
                *    3.6. Se para el foco al primer elemento que lo soporte o al designado por el usario con data-autofocus
                *    3.7. Se aplica la clase 'active' al wrapper para que de inicio a las animaciones de entrada
                * 4. Si se desactiva el modal
                *    4.1. xxx
                */
                db._on('attributechange', (attrName, oldValue, newValue) => {
                    if ('state' != attrName || ! newValue) { return false; }

                    const attr = db.getAttr;

                    if ('active' == newValue) {
                        if (db.$el.toggler ) { db.$el.toggler._addClass('active'); }

                        db.$el.previousFocus = document.activeElement;//Guardamos una referencia al alemento que actualmente tiene el foco
                        db._bindInteractiveElements();
                        db._setFocus();

                        if (attr['load-url-onopen']) {
                            const loadUrlOnAnimationEnd = (e) => {
                                if(db.$el.window == e.target) {
                                    db._loadUrl(attr['load-url-onopen']);
    
                                    db.$el.window._removeOn('animationend', loadUrlOnAnimationEnd);
                                }
                            }

                            db.$el.window._on('animationend', loadUrlOnAnimationEnd);                        
                        }

                        if (attr.snackbar) {
                            let focusableElem = selectFocusable(db.$el.content);
                            
                            if (focusableElem.length) { return false; }//Si hay algun elemento inteactivo, evitamos el cierre automático

                            if (! /^\d+(\.?\d+)?$/.test(attr.snackbar)) { attr.snackbar = 3 * 1000; }

                            let snackIntervalTime = 12;
                            let snackIntervalIterations = 0;
                            let snackIntervalIncrement = 1;
                            
                            if (attr['snackbar-progress'] && ! db.$el.snackbarProgress) {
                                //'<div style=width: 100%; height: 4px; background-color: var(--bg-color-3);></div>'
                                db.$el.snackbarProgress = create('div', false, {
                                    innerHTML: '<div style="width: 100%; height: 4px; background-color: var(--text-color-1);"></div>',
                                    style: {position: 'absolute', bottom: '0', width: '100%', height: '4px', zIndex: '1'}
                                });

                                db.$el.body._insertAfter(db.$el.snackbarProgress);
                            }

                            //OJO:, aquí hay que agregar un mousedown para que tambien funciones el touch
                            db.$el.window._on('mouseenter', (e) => {
                                snackIntervalIncrement = 0;

                                db.$el.window._on('mouseleave', (e) => { snackIntervalIncrement = 1; });
                            });

                            let snackInterval = setInterval(() => {
                                snackIntervalIterations += snackIntervalIncrement;

                                let countDownBarWidth = Math.round((attr.snackbar - (snackIntervalTime * snackIntervalIterations)) / attr.snackbar * 100);

                                if (db.$el.snackbarProgress) { db.$el.snackbarProgress.style.width = countDownBarWidth + '%'; }

                                if (countDownBarWidth <= 0) {
                                    snackIntervalIterations = 0;

                                    //Simulamos el cierre por la tecla escape
                                    db._closeDialog({key: 'Escape', preventDefault: () => {}, stopPropagation: () => {}, });

                                    clearInterval(snackInterval);
                                }
                            }, snackIntervalTime);
                        } else {
                            //Registro de dialogs, el último dialog registrado será tomado en cuenta para el trapFocus y _closeDialog con escape
                            app.dialogs.push(db);//Registramos el dialog

                            if (virtualKeyboardIsPossible) {
                                let windowHeight = db.$el.body.scrollHeight + db.$el.header.clientHeight + db.$el.footer.clientHeight;
                                let viewHeight = window.innerHeight;
                                
                                if (windowHeight > viewHeight && ! attr['scroll-on-body']) { db.setAttr = {'scroll-on-wrapper': true}; }
                            }
    
                            if (bodyFixedClass) {
                                if (! bodyFixedStyle) {
                                    let scrollWidth = Math.ceil(window.innerWidth - document.body.getBoundingClientRect().width) + 2;
    
                                    bodyFixedStyle = createStyle(/*html*/`
                                        :root { --scrollbar-width: ${scrollWidth}px; }
                                        body.${bodyFixedClass} {
                                            padding-right: ${scrollWidth}px;
                                            overflow: hidden;
                                            scroll-padding-bottom: 0;
                                            transition: padding-right 0s;
                                        }
                                    `);
                                }
    
                                db._insertBefore(bodyFixedStyle);
                                
                                //OJO: Esta línea no debería existir, algo esta haciendo que el body no tenga _addClass
                                //Voy a probar poniendo este script en async
                                appendActions(document.body);
    
                                document.body._addClass(bodyFixedClass);
                            }
    
                            app.pushState(db.id, db._closeDialog);//Back button del navegador o hardware back button
    
                            /*
                             * Si esta funcion se llega a ejecutar, puede generar un scroll hacia el inicio del documento
                             * Usamos el tercer parámetro, true (Alias de {capture: true}), para capturar todos los elementos por debajo de window, 
                             * pero fuera del modal
                             * https://javascript.info/bubbling-and-capturing
                             */
                            window._on('focus', db._trapFocus, true);
                            arrowkeysdownListener = window._on('arrowkeysdown', db._arrowKeysDownFnc, true);
                            escapedownListener = window._on('escapedown', db._closeDialog, true);
                        }
                        
                        if (db._onOpen) { db._onOpen(db); }
                        
                        return false;
                    }

                    if ('inactive' == newValue) {
                        let elemToWaitOn = ! attr.snackbar ? db.$el.backdrop : db.$el.window;

                        const animationEndCleanUp = (e) => {
                            if(elemToWaitOn == e.target) {
                                if (db.$el.toggler) {
                                    db.$el.toggler._removeClass('active');
                                    db.$el.toggler.focus({preventScroll: true});
                                } else {
                                    if (db.$el.previousFocus) {
                                        db.$el.previousFocus.focus({preventScroll: true});//Elemento previamente activo, antes de abrir el modal
            
                                        /* Testeamos a ver si el foco anterior estabas en otro modal */
                                        //if (db.$el.previousFocus?.$el?.focusFirst) { db.$el.previousFocus.$el.focusFirst.focus({preventScroll: true}); }
                                        //if (db.$el.previousFocus?.$el?.initFocus) { db.$el.previousFocus.$el.initFocus.focus({preventScroll: true}); }
                                    }
                                }
        
                                //if (attr.snackbar && db.$el.snackbarProgress) { db.$el.snackbarProgress.style.width = '0%'; }
                                
                                if (bodyFixedClass) { document.body._removeClass(bodyFixedClass); }
                                if (bodyFixedStyle) { bodyFixedStyle._remove(); }
    
                                db.removeAttribute('state');//OJO: Esta línea se puede remover
                                //db._closeDialog();

                                elemToWaitOn._removeOn('animationend', animationEndCleanUp);

                                if (attr['self-destroy']) { db._remove(); };
                            }
                        }

                        if (! attr.snackbar) {
                            //Elminamos el modal del registro de modales (Otras formas: app.dialogs.length--; app.dialogs.splice(-1, 1); app.dialogs.slice(0, app.dialogs.length - 1);)
                            app.dialogs.pop();

                            app.pullState(db.id);
                    
                            //Removemos los eventos con el tercer parámetro, al igual que como los creamos
                            window._removeOn('focus', db._trapFocus, true);
                            //Esta es la manera de remover los eventos personalizados, guardando una referencia de los argumentos que fueron modificados por el helper
                            if (arrowkeysdownListener) { window._removeOn(...arrowkeysdownListener); }
                            if (escapedownListener) { window._removeOn(...escapedownListener); }
                        }

                        if (db._onClose) { db._onClose(db); }
                        
                        //elemToWaitOn._on('animationend', animationEndCleanUp, {once: true});
                        elemToWaitOn._on('animationend', animationEndCleanUp);
                    }
                });

                //OJO:Aquí voy a probar atrapar el foco, sin necesidad de usar los trapFocus
                /* db.$el.wrapper._on('click', (e) => {
                    e.preventDefault();

                    console.log(e);
                }); */

                //El backdrop esta detrás del wrapper lo que no permite que le llegue el click
                if (! attr.snackbar) {
                    //OJO: Hack provicional
                    db.$el.wrapper._on('click', (e) => {
                        //e.preventDefault();

                        if (e.target == db.$el.wrapper) { db.$el.backdrop._event('click'); }
                    });
                }

                //Si el componente quiere iniciar activo, lo activamos
                if (attr.state && 'active' == attr.state) { db.setAttr = {'state': 'active'}; }

                if (attr['load-url']) { db._loadUrl(attr['load-url']); }
            }
        });
    }

    /*
    //Componente genérico útil para encapsular y/o separar código
    <generic-component src="./components/component.html"></a-dialog>

    Atributos (Sumados a los atributos globales mensionados arriba)
        src = './ruta/componente.html'
        abort-time = 10000
    */
    if (! customElements.get('generic-component')) {
        defineCustomElement({tag: 'generic-component', mode: 'closed',
            onMount: async (cpnt) => {
                const attr = cpnt.getAttr;

                if (attr['src']) {
                    console.log(11111111);

                    const result = await loadFileContent(url, 'html/text', attr['abort-time'] || false);

                    if (! result.ok) {
                        console.error('Error: ', result?.message || result);
                    } else {
                        cpnt._root.appendChild(appendActions(document.createRange().createContextualFragment(content)));

                        console.log(222222222);
                    }
                    
                    console.log(33333333);
                }
            }
        });
    }
})();