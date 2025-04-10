// Ami-io
const AmiIo = require('ami-io');

// Main Class
class AMIService {
	/**
	 * Constructor
	 */
	constructor(_config, _logger) {
		this.config = _config;
		this.logger = _logger;

		const SilentLogger = new AmiIo.SilentLogger();
		_config.logger = SilentLogger;

		// AMI Client
		this.amiio = null;
		this.amiconn = false;

		this.logger.debug('[AMI] AMI Initialized');
	}

	/** Start Asterisk AMI */
	start() {
		this.amiio = AmiIo.createClient(this.config);
		this.#amiconnect();
		this.#amievents();
		this.logger.debug(`[AMI] AMI Started : ${this.config.host}:${this.config.port}`);
	}

	/** Stop AMI and Clean */
	stop() {
		if (this.amiio) {
			this.#amidisconnect();
		}
	}

	getAmiConn() {
		return this.amiconn;
	}

	/** AMI Connect */
	#amiconnect() {
		this.amiio.connect();
	}

	/** AMI Disconnect */
	#amidisconnect() {
		this.amiio.disconnect();
		this.amiconn = false;
	}

	/**
	 * Execute AMI Action
	 * @param {Object} action Result for AMI Action
	 */
	#amiaction(action) {
		this.amiio.send(action, (err, data) => {
			if (err) {
				return {};
			} else {
				return data;
			}
		});
	}

	connectedState(){
		return this.amiconn;
	}

	/** Reconnect */
	reconnect() {
		if (!this.amiconn) {
			this.logger.debug('[AMI] Try to Reconnect : (' + this.config.host + ')');
			this.#amiconnect();
		}
	}

	/** Active AmiEvents Listeners */
	#amievents() {
		this.amiio.on('disconnected', () => {
			this.logger.debug('[AMI] Disconnected (' + this.config.host + ')');
			this.amiconn = false;

			setTimeout(() => {
				this.reconnect();
			}, 60000);
		});
		this.amiio.on('connected', () => {
			this.amiconn = true;
			this.logger.debug('[AMI] Connected (' + this.config.host + ')');
		});

		this.amiio.on('incorrectServer', () => {
			this.logger.error('[AMI] Incorrect Server (' + this.config.host + ')');
		});

		this.amiio.on('connectionRefused', () => {
			this.logger.error('[AMI] Connection Refused (' + this.config.host + ')');
		});

		this.amiio.on('incorrectLogin', () => {
			this.logger.error('[AMI] Incorrect Login (' + this.config.host + ')');
		});

		// Received Events
		this.amiio.on('event', event => {
			switch (event.event) {
				case 'PeerStatus':
				case 'ExtensionStatus':
				case 'DeviceStateChange':
				case 'QueueMemberAdded':
				case 'QueueMemberPause':
				case 'QueueMemberRemoved':
				case 'QueueMemberStatus':
				case 'QueueCallerJoin':
				case 'QueueCallerLeave':
				case 'QueueCallerAbandon':
				case 'AgentCalled':
				case 'AgentConnect':
				case 'AgentRingNoAnswer':
				case 'AgentComplete':
				case 'OriginateResponse':
				case 'Newchannel':
				case 'Hangup':
				case 'UserEvent':
				case 'Cdr':
				case 'Registry':
				case 'Reload':
				case 'FullyBooted':
				case 'Newexten':
				case 'Newstate':
				case 'NewConnectedLine':
				case 'NewCallerid':
				case 'VarSet':
				case 'HangupRequest':
				case 'SoftHangupRequest':
				case 'HangupHandlerPush':
				case 'HangupHandlerRun':
				case 'Hold':
				case 'Unhold':
				case 'MusicOnHoldStart':
				case 'MusicOnHoldStop':
				case 'DialBegin':
				case 'DialState':
				case 'DialEnd':
				case 'BridgeCreate':
				case 'BridgeEnter':
				case 'BridgeLeave':
				case 'BridgeDestroy':
				case 'MixMonitorStart':
				case 'MixMonitorStop':
				case 'RTCPSent':
				case 'RTCPReceived':
				case 'DTMFBegin':
				case 'DTMFEnd':
				case 'LocalBridge':
				case 'ChanSpyStart':
				case 'PresenceStateChange':
				case 'BlindTransfer':
				case 'PresenceStatus':
				case 'LocalOptimizationBegin':
				case 'LocalOptimizationEnd':
				case 'PresenceStatus':
				case 'ContactStatus':
					// Nothing to Do
					break;
				default:
					console.log('Event : ', event);
					break;
			}
		});
	}

	actionOriginate = async (channel, exten, context, priority) => {
		return new Promise((resolve, reject) => {
			if (!this.amiconn || !this.amiio) {
				this.logger.error('[AMI] No hay conexión con AMI para originar llamada');
				reject(new Error('No hay conexión con AMI'));
				return;
			}

			this.amiio.send(this.#originate(channel, exten, context, priority), (err, result) => {
				if (err) {
					this.logger.error(`[AMI] Error originando llamada: ${err.message}`);
					reject(err);
				} else if (result.response === 'Success') {
					resolve(result.response);
				} else {
					this.logger.error(`[AMI] Fallo en originate: ${result.message || 'Sin detalles'}`);
					reject(new Error(result.message || 'Fallo en originate'));
				}
			});
		});
	}

	#originate(channel, exten, context, priority) {
		if (this.amiconn && this.amiio) {
			var action = new AmiIo.Action.Action('Originate');
			action.Channel = channel;
			action.Exten = exten;
			action.Context = context;
			action.Priority = priority;

			return action;
		}
		return null;
	}
}

// ------------- Exports ------------- //
module.exports = AMIService;