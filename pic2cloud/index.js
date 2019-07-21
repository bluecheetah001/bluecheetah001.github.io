const {h, render, Component} = window.preact;

function wipeLocalStorage() {
    window.localStorage.clear();
    window.location.replace("https://bluecheetah001.github.io/pic2cloud");
}

const base64urlChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function randomData(len) {
    const arr = new Uint8Array(len);
    window.crypto.getRandomValues(arr);
    let data = '';
    for(let i=0;i<len;i++) {
        data += base64urlChars[arr[i]&0x3f];
    }
    return data;
}

// args must be already seperated from the url
function parseArgs(args) {
    const obj = {};
    args.split('&').forEach((keyVal) => {
        // replace missing value with ''
        keyVal = keyVal.split('=');
        if(keyVal.length == 1) {
            keyVal[1] = '';
        }
        obj[window.decodeURIComponent(keyVal[0])] = window.decodeURIComponent(keyVal[1]);
    });
    return obj;
}

function fixUrl() {
    // TODO add fragment for service and path
    window.history.replaceState(null, document.title, "https://bluecheetah001.github.io/pic2cloud");
}

const BAD_PARAM = 'BAD_PARAM';
const EXPIRED_TOKEN = 'EXPIRED_TOKEN';
const TOKEN_PRIVLEDGE = 'TOKEN_PRIVLEDGE';
const INVALID_TOKEN = 'INVALID_TOKEN';
const USER_PRIVLEDGE = 'USER_PRIVLEDGE';
const ENDPOINT_SPECIFIC = 'ENDPOINT_SPECIFIC';
const SERVER_ERROR = 'SERVER_ERROR';
const UNKNOWN_STATUS = 'UNKNOWN_STATUS';
const NETWORK_ERROR = 'NETWORK_ERROR';
class ApiError extends Error {
    constructor(status, response) {
        super(response);
        this.status = status;
        this.response = response;
    }
}

const dropbox = {
    name: 'Dropbox',
    noAccount: {token:null, id:null, name:null},
    _send(url, account, params = null) {
        return this._sendImpl(url +
            '?authorization='+window.encodeURIComponent('Bearer '+account.token) +
            '&reject_cors_preflight=true', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain; charset=dropbox-cors-hack',
            },
            body: JSON.stringify(params),
        });
    },
    _sendImpl(url, init) {
        return new Promise((resolve, reject) => {
            fetch(url, init).then((response) => {
                switch(response.status) {
                    case 200: // ok
                        resolve(response.json());
                        return;
                    case 400: // bad parameter
                        reject(new ApiError(BAD_PARAM, response.text()));
                        return;
                    case 401: // bad token
                        const reason = response.json();
                        switch(reason.error['.tag']) {
                            case 'expired_access_token':
                                reject(new ApiError(EXPIRED_TOKEN));
                                return;
                            case 'missing_scope':
                                reject(new ApiError(TOKEN_PRIVLEDGE, reason.error.required_scope));
                                return;
                            default:
                                reject(new ApiError(INVALID_TOKEN, reason.error_summary));
                                return;
                        }
                    case 403: // bad user
                        reject(new ApiError(USER_PRIVLEDGE, response.json()));
                        return;
                    case 409: // edpoint specific
                        reject(new ApiError(ENDPOINT_SPECIFIC, response.json()));
                        return;
                    case 429: // rate limited
                        let wait = 1;
                        let reasonText = null;
                        // response can be text for some reason...
                        if(response.headers.get('Content-type') == 'application/json') {
                            const reason = response.json();
                            wait = reason.retry_after || 1;
                            reasonText = reason.reason['.tag'];
                        } else {
                            reasonText = response.text();
                        }
                        console.log(`Retrying ${url} in ${wait}s (${reasonText})`);
                        window.setTimeout(() => {
                            resolve(this._sendImpl(url, init));
                        }, 1000*wait);
                        return;
                }
                if(response.status >= 500 && response.status < 600) { // server error
                    reject(new ApiError(SERVER_ERROR, response.status + ' ' + response.statusText + '\n' + response.text()));
                } else { // unknown
                    reject(new ApiError(UNKNOWN_STATUS, response.status + ' ' + response.statusText + '\n' + response.text()));
                }
            }, (error) => {
                reject(new ApiError(NETWORK_ERROR, error));
            });
        });
    },
    getLogin() {
        return new Promise((resolve, reject) => {
            const splitFragment = window.location.href.split('#');
            const authState = window.localStorage.authState;
            delete window.localStorage.authState;

            let token = window.localStorage.dropboxAccessToken;

            if(splitFragment.length == 2 && authState) {
                const args = parseArgs(splitFragment[1]);
                // ignore fragment args if missing data
                if(args.access_token && args.token_type === 'bearer' && args.state === authState) {
                    token = args.access_token;
                }
            }

            if(token) {
                this._send('https://api.dropboxapi.com/2/users/get_current_account', {token}, null)
                    .then((response) => {
                        const id = response.account_id;
                        const name = response.name.display_name;
                        resolve({token, id, name});
                    }, (error) => {
                        switch(error.status) {
                            case INVALID_TOKEN:
                                console.log('invalid token ', error.response);
                                // fallthough
                            case EXPIRED_TOKEN:
                                resolve(this.noAccount);
                                return;
                        }
                        error.source = 'getLogin';
                        reject(error);
                    });
            } else {
                resolve(this.noAccount);
            }
        }).then((response) => {
            if(response.token) {
                window.localStorage.dropboxAccessToken = response.token;
            } else {
                delete window.localStorage.dropboxAccessToken;
            }
            fixUrl();
            return response;
        }, (error) => {
            delete window.localStorage.dropboxAccessToken;
            throw error;
        });
    },
    openLoginPage(logout=false) {
        const state = randomData(100);
        window.localStorage.authState = state;

        const splitFragment = window.location.href.split('#');

        window.location.href = 'https://www.dropbox.com/oauth2/authorize'
            + '?response_type=token'
            + '&client_id=y5xzv1dv09k6swz'
            + '&force_reauthentication='+logout
            + '&redirect_uri='+encodeURIComponent('https://bluecheetah001.github.io/pic2cloud')
            + '&state='+state;
    },
}

class OauthComponent extends Component {
    constructor(props) {
        super(props);
        this.state.account = {};
        props.api.getLogin()
            .then((account) => {
                this.setState({account});
                // TODO event?
            }, (error) => {
                this.props.onError(error)
            });
    }
    render({api}, {account}) {

        if(account.token) {
            return h('div', null,
                'Logged in as '+account.name,
                h('br'),
                h('button', {onClick:api.openLoginPage.bind(api, true)}, 'Change '+api.name+' login')
            );
        } else {
            return h('div', null,
                'Not logged in',
                h('br'),
                h('button', {onClick:api.openLoginPage.bind(api, false)}, 'Login to '+api.name)
            );
        }
    }
}

class App extends Component {
    render({api}) {
        return h('div', null,
            h('h1', null, 'Test p2c landing page'),
            h('br'),
            h('button', {onClick:wipeLocalStorage}, 'Wipe'),
            h('br'),
            h(OauthComponent, {api:api, onError:console.error}),
        )
    }
}

render(h(App, {api:dropbox}), document.body);
