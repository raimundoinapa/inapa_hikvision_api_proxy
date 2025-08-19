(() => {
    const { app, sleep, appendActions, onDomReady, select, create } = __CPLIB__;

    const script = appendActions(document.currentScript);
    
    const loginModal = script._insertBefore(/*html*/`
        <a-dialog id="login-form-modal" state="active" close-button>
            <style slot="styles">
                .window { min-width: 380px; }
                .footer { margin-bottom: 1rem; }

                .options-separator { gap: 1rem; }
                .options-separator::before,
                .options-separator::after {
                    position: relative;
                    width: 46%;
                    height: 1px;
                    background-color: var(--accent-1);
                }
                /*#login-title { margin-bottom: 1.1rem; }
                #signup-link { margin-bottom: 10px; }
                .submit-row { margin-bottom: 0.5rem; }
                #login-options { gap: 1rem; }
                .options-separator { gap: 1rem; }
                .options-separator::before,
                .options-separator::after {
                    position: relative;
                    width: 46%;
                    height: 1px;
                    background-color: var(--accent-1);
                }
                .options-separator::after {
                    left: auto;
                    right: auto;
                }
                .options-separator span {
                    font-size: 1.2rem;
                    font-weight: bold;
                }
                .social-login-row { margin-bottom: 2rem; }
                .social-login-buttons { gap: 12px; }
                .social-login-buttons button {
                    padding: 0;
                    width: 35px;
                    height: 35px;
                    background: none;
                }*/
            </style>
            <div slot="header"><h4 id="login-title" class="mb0">Iniciar sesión</h4></div>
            <div>
                <div id="signup-link" class="small t-right mb1"><span>No tienes cuenta?</span> <a href="javascript:void(0);">Regístrate</a></div>
                <form action="/login" method="post" id="login-form" is="super-form">    
                    <div class="form-row">
                        <input type="text" name="emailOrPhone" autocomplete="username" autocapitalize="off" placeholder="Email ó teléfono" title="Introduzca un correo o número de teléfono válido" pattern="^(\\w+(([\\-+_]*\\w)|([\\-+_\\w]*\\.[\\-+_]*\\w))*@[\\wñÑ]+[\\-+_\\w]*(\\.\\w+)*\\.\\w+)|(\\+?\\d{9,15})$" data-autofocus="true" required>
                        <label for="emailOrPhone" class="label-placeholder">Email ó teléfono</label>
                    </div>
                    <div class="form-row">
                        <input type="password" name="password" placeholder="Password" autocomplete="password" spellcheck="false" title="Debe contener letras mayúsculas y minúsculas, números y caractereres especiales #?!@$%^&*.,;:\`'_-~+=<>[](){}|/\\ y contener entre 8 y 32 caracteres" required>
                        <label for="password" class="label-placeholder">Password</label>
                    </div>
                    <div class="form-row">
                        <input type="email" name="test" placeholder="test">
                        <label for="test" class="label-placeholder">test</label>
                    </div>
                    <div class="form-row">
                        <select name="sel" required><option value="">Seleccione</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select>
                        <label for="sel" class="label-placeholder">Select</label>
                    </div>
                    <div class="form-row submit-row">
                        <button type="submit" class="btn-loading w100">Iniciar sesión</button>
                    </div>
                    <div id="login-options" class="p-relative d-flex space-between mb0-5">
                        <div class="d-flex-center gap0-5">
                            <div class="d-flex-center gap0-5">
                                <input type="checkbox" name="keepmeloggedin" class="switch">
                                <label for="keepmeloggedin" class="small">Recordarme</label>
                            </div>
                            <a is="tool-tip-link" data-tooltip_content="<p class='small'>Al elegir esta opción permanecerás logeado por más tiempo, sin que se te pida iniciar sesión. Usa esta opción solo en dispositivos personales.</p>">(?)</a>
                        </div>
                        <a href="javascript:void(0);" class="forgot-password-link small">¿Olvidaste tu contraseña?</a>
                    </div>
                    <!--<div class="form-row">
                        <div is="a-component" data-captcha_name="test" class="d-flex"></div>
                    </div>-->
                </form>
                <div class="options-separator mb1 d-flex-center content-before content-after"><span class="d-flex-center">o</span></div>
                <div class="social-login-row">
                    <h5 class="h6 t-center">Iniciar sesión con</h5>
                    <div class="social-login-buttons d-flex-center gap1">
                        <a-button circle outline  wave><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAMAAABg3Am1AAAAjVBMVEVHcEwwnU/VPjYvnk/VPjUvnVDWSDRQcKehaUFQcKhOc6Iunk7VPTXVPjVQcKdQcKjZWDMvnU7VPTXvtikwnVDWPTXvtSnurSpQcKfVPjYunk7ttChQcajstSgwn0zttCjvtShQcKlQcKgvnk/VPjbvtSnjfi7bsy07n009inXYTTSDqD6bqzqnrTdTokc44COHAAAAInRSTlMAPc/b5r4jPxC/oJBVkIjlQGOjtyC/0/cggIB7X2BQoJ/Psru6sQAAAUhJREFUSMftlduWgiAUhjGBoRTT0uw4B8Gp5vT+jzeGOggCC5vb/iuX6/vYe6MoAI/cFRLTGeScw4LGHnha8EHgCk/BRZwK5YZAa2Ok4OZYDDKz8DNiFqbyu0HXNMY4jVfQxWOJp3IRaOUB/NvGIYGpjT+9d/zO831Y1+WHWN+Tx3WTpgjEnsKpbg0KvDsSKWWB7ZMeRdi0wkbeWVRa3hShbIW1Q1gqQsvXB4dQ/U/oWnr1FjyGVmd4aYWzfHOSeZ9lK8wV4SD4r8ve8Iw6IVFP2235T8ZYPuKPXUtH/VGffxqeIVuBaqt9X74vTERvKqlMIzRBrEtETLzeEQBBL7AwkzeReVNFIiaV6DnIgywKm+urcQK1KTXX8Z72WxuaDWbhG8NSgy2sB29v5DPHUc3HRVDgPt0BmoSLKlmEbvOHYZSRxx/8rvwCaQpYY51gRIUAAAAASUVORK5CYII=" alt="Iniciar sesión con Google"></a-button>
                        <a-button circle outline  wave><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsBAMAAADsqkcyAAAALVBMVEVHcEwYdfEYdvIXd/IYd+8Xd+8Xd/IXd/IQcO8Yd/IXd/EXd/IYdvMXdvIYd/JU6UsnAAAADnRSTlMAgKDGQCFa7xDfkK9/bxPrucEAAAFTSURBVCjPbdM/S8NAFADwh9Ua/Idx6lSKOEuhg+IQMjtIKWRxKNncOokIQhCcXKSfIIsgTqGrS/ETCH4Da/+EtHKfwbvkvcu75t5ydz+Ou5d3eQBFOJcfUdp5ewQjNs9EHqvQUE9gZMy3tMr9Xc03gsUd6Z4w4hP5y+Q/62baPtDrh+NOLIdFnkZMeqJSlWOqktkgvQVk0eZnhJpnckJn/ILmKY4q5iULvzx6qPD7KJ+3YJt4JPkU5/dwRdwCqNN8Bk2aHrLvXYLHWN+zsnMGkY1TEDYWyPMgkI/uBMG1wT/0UrvIsck1vHJs8oEoapWY3MfPGZhc1GIBL/k4cV1f1sR1x1jkmi3vNuzbOAQnqnImL2lWWf0oz1UeQvnGjH2VarLOE1YGxqOimzyTp9hXTyafUyESzkvdO/W45JS1Wq/kd96YvbjgtLHWxq+Sdy58XP4DJ30Z99MJep4AAAAASUVORK5CYII=" alt="Iniciar sesión con Facebook"></a-button>
                        <a-button circle outline  wave><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwBAMAAAClLOS0AAAAKlBMVEVHcExVrO5Vre5Uq+1VrO5VrO5Tqe9VrO5Qre9VrO9VrO5UrO5Tqu9VrO5XKaJ3AAAADXRSTlMA26M7gO8gYBBvv5BQFItffAAAASNJREFUOMtjYBgCoGXp1ZUJWMQ5Y+/evXsFKF8A4lUjJHTvgoDyrItgXbIOMHHuu1BwHcTjAOmFgFqYhEM7kMd89+4GqIQsVPzWrGsQCYiRIBYMTABy2SAOAbkJLg7hg5woDmKwwMSvgl3LsBfEFkpAkrgEsdIWzLm4x4ATTQLuelFUCQ4O2btoAGI388qD6BI3wRJsdzHAHQa4c1HBZYiEL4ZEAESiFUNCASLBjiFRwIDDrAaoBBuaRy7BY5QZVeYaTJxVFqvdSKEKBfD0gxZYVxCpJhFFQgAhwaaLJH4ROSXy6GIEFEaSgnsbArrh4uGoiRwe9BcNkITZihBRooEQthJEcpIwsjlVCHFJVBclQX1+VRk9IzFXL4y9K6hpMPiLAgAShJKTONKnlQAAAABJRU5ErkJggg==" alt="Iniciar sesión con Twitter"></a-button>
                    </div>
                </div>
            </div>
            <div class="policies-wrapper" slot="footer">
                <p class="small t-center">Al continuar, aceptas nuestras<br> <a href="javascript:void(0);">Políticas de privacidad</a> y <span id="test-holder"></span><a href="javascript:void(0);">Términos de servcio</a></p>
            </div>
            <a-dialog id="confirmation-code-modal" close-button contained data-bind="confirmation_code" slot="after-content">
                <form action="/confirmation-code" method="post" id="confirmation-code-form" class="mb1" is="super-form">
                    <h4 id="login-title">Código de confirmación</h4>
                    <div class="form-row">
                        <input type="text" name="confirmationCode" data-autofocus="true" placeholder="Código de confirmación" autocomplete="off" title="Introduzca el código de confirmación" pattern="^\d{6}$" required>
                        <label for="confirmationCode" class="label-placeholder">Código de confirmación</label>
                    </div>
                    <div class="form-row submit-row">
                        <button type="submit" class="btn-loading w100">Aceptar</button>
                    </div>
                </form>
                <a-dialog id="inner-modal" close-button contained slot="after-content">
                    <form action="/confirmation-code" method="post" id="confirmation-code-form" class="mb1" is="super-form">
                        <h4 id="login-title">Código de confirmación</h4>
                        <div class="form-row">
                            <input type="text" name="confirmationCode" data-autofocus="true" placeholder="Código de confirmación" autocomplete="off" title="Introduzca el código de confirmación" pattern="^\d{6}$" required>
                            <label for="confirmationCode" class="label-placeholder">Código de confirmación</label>
                        </div>
                        <div class="form-row submit-row">
                            <button type="submit" class="btn-loading w100">Aceptar</button>
                        </div>
                        <a-dialog id="inner-inner-modal" close-button contained slot="after-content">
                            <form action="/confirmation-code" method="post" id="confirmation-code-form" class="mb1" is="super-form">
                                <h4 id="login-title">Código de confirmación</h4>
                                <div class="form-row">
                                    <input type="text" name="confirmationCode" data-autofocus="true" placeholder="Código de confirmación" autocomplete="off" title="Introduzca el código de confirmación" pattern="^\d{6}$" required>
                                    <label for="confirmationCode" class="label-placeholder">Código de confirmación</label>
                                </div>
                                <div class="form-row submit-row">
                                    <button type="submit" class="btn-loading w100">Aceptar</button>
                                </div>
                            </form>
                        </a-dialog>
                        <a-dialog id="inner-inner-modal2" close-button contained slot="after-content">
                            <form action="/confirmation-code" method="post" id="confirmation-code-form" class="mb1" is="super-form">
                                <h4 id="login-title">Código de confirmación</h4>
                                <div class="form-row">
                                    <input type="text" name="confirmationCode" data-autofocus="true" placeholder="Código de confirmación" autocomplete="off" title="Introduzca el código de confirmación" pattern="^\d{6}$" required>
                                    <label for="confirmationCode" class="label-placeholder">Código de confirmación</label>
                                </div>
                                <div class="form-row submit-row">
                                    <button type="submit" class="btn-loading w100">Aceptar</button>
                                </div>
                                <a-dialog id="inner-inner-inner-modal" close-button contained slot="after-content">
                                    <form action="/confirmation-code" method="post" id="confirmation-code-form" class="mb1" is="super-form">
                                        <h4 id="login-title">Código de confirmación</h4>
                                        <div class="form-row">
                                            <input type="text" name="confirmationCode" data-autofocus="true" placeholder="Código de confirmación" autocomplete="off" title="Introduzca el código de confirmación" pattern="^\d{6}$" required>
                                            <label for="confirmationCode" class="label-placeholder">Código de confirmación</label>
                                        </div>
                                        <div class="form-row submit-row">
                                            <button type="submit" class="btn-loading w100">Aceptar</button>
                                        </div>
                                    </form>
                                </a-dialog>
                            </form>
                        </a-dialog>
                    </form>
                </a-dialog>
            </a-dialog>
        </a-dialog>
    `);

    onDomReady(async () => {
        let loginFormModal = select('#login-form-modal');
        let loginForm = loginFormModal._select('#login-form');
        let loginTitle = loginFormModal._select('#login-title');
        let signupLinkQuestion = loginFormModal._select('#signup-link span');
        let signupLinkAction = loginFormModal._select('#signup-link a');
        let loginOptions = loginFormModal._select('#login-options');
        let forgotPasswordLink = loginFormModal._select('.forgot-password-link');
        let ccModalLink = loginFormModal._select('[aria-controls="confirmation-code-modal"]');
        let confirmationCodeModal = loginFormModal._select('#confirmation-code-modal');
        let input = loginFormModal._select('[name="emailOrPhone"]');

        let params = {
            login: {
                id: 'login-form',
                action: '/login',
                actionTitle: 'Iniciar sesión',
                question: 'No tienes cuenta?',
                counterAction: 'Regístrate',
                showOptions: true
            },
            signup: {
                id: 'sigup-form',
                action: '/signup',
                actionTitle: 'Regístrate',
                question: 'Ya tienes cuenta?',
                counterAction: 'Inicia sesión',
                showOptions: false
            }
        }
        let loginFormReset = () => {
            loginForm.reset();

            //loginForm.elements['emailOrPhone'].focus();

            for (const e of loginForm.elements) { e._removeClass('input-error'); }
        }

        loginFormModal._onOpen = () => { loginFormReset(); };

        signupLinkAction._on('click', (e) => {
            e.preventDefault();

            let thisLink = e.currentTarget;

            if (thisLink.disabled) { return false; }

            if (! thisLink._params) { thisLink._params = params.login; }

            thisLink._params = ! thisLink._params.showOptions ? params.login : params.signup;
            
            if (! thisLink._params.showOptions) {
                //Formulario de Registro
                loginOptions.style.visibility = 'hidden';
            } else {
                loginOptions.style.visibility = 'visible';
            }

            loginForm.action = thisLink._params.action;
            loginForm.form_id = thisLink._params.id;
            loginForm._submitButton.firstChild.nodeValue = thisLink._params.actionTitle;
            loginTitle.textContent = thisLink._params.actionTitle;
            signupLinkQuestion.textContent = thisLink._params.question;
            signupLinkAction.textContent = thisLink._params.counterAction;

            loginFormReset();
        });

        forgotPasswordLink._on('click', (e) => {
            e.preventDefault();

            let thisLink = e.currentTarget;

            if (thisLink.disabled) { return false; }
        });

        loginForm._onBeforeSubmit = (frm)  => { loginFormModal._preventDismiss = true; }

        loginForm._fnc = (frm, response, fullResponse)  => {
            loginFormModal._preventDismiss = false;
            
            return false;
        }

        let test = create(['button', {is: 'dialog-button'}], {type: 'button', 'aria-controls': 'confirmation-code-modal'}, {innerHTML: 'Hola', className: 'anchor-styled'});
        
        test._target = loginFormModal._select('#confirmation-code-modal');
        
        loginFormModal._select('#test-holder').appendChild(test);
    });
})();