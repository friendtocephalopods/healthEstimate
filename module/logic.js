import {breakOverlayRender, descriptionToShow, fractionFormula, updateBreakSettings} from './systemSpecifics.js';
import {sGet, t} from './utils.js';

export let descriptions, deathStateName, showDead, useColor, smooth, NPCsJustDie, deathMarker, colors, outline, deadColor, deadOutline, perfectionism, outputChat;

let current_hp_actor = {}; //store hp of PC

export function getCharacters(actors) {
	for (let actor of actors) {
		const fraction = Math.min(fractionFormula(actor), 1);
		const stage = Math.max(0,
			perfectionism ?
			Math.ceil((descriptions.length - 2 + Math.floor(fraction)) * fraction) :
			Math.ceil((descriptions.length - 1) * fraction)
		);
		current_hp_actor[actor.data._id] = {'name': actor.document.data.name || actor.name, 'stage':stage, 'dead':isDead(actor, stage)};
	}
}

export function outputStageChange(actors) {
	for (let actor of actors) {
		const fraction = Math.min(fractionFormula(actor), 1);
		const stage = Math.max(0,
			perfectionism ?
			Math.ceil((descriptions.length - 2 + Math.floor(fraction)) * fraction) :
			Math.ceil((descriptions.length - 1) * fraction)
		);
		const dead = isDead(actor, stage);
		if (stage && (stage != current_hp_actor[actor.data._id].stage || dead != current_hp_actor[actor.data._id].dead)) {
			let name = current_hp_actor[actor.data._id].name;
			if (actor.document.getFlag('healthEstimate', 'hideHealthEstimate') && actor.data.displayName==0) {
				name = "Unknown entity";
			}
			let css = "<span class='hm_messagetaken'>";
			if (stage > current_hp_actor[actor.data._id].stage) {
				css = "<span class='hm_messageheal'>";
			}
			let desc = descriptionToShow(descriptions, stage, actor, {
				isDead: dead,
				desc : deathStateName,
			}, fraction);
			let chatData = {
				content: (css + name + " " + t("core.isNow") + " " + desc + ".</span>")
			};
			ChatMessage.create(chatData, {});
			current_hp_actor[actor.data._id].stage = stage;
			current_hp_actor[actor.data._id].dead = dead;
		}
	}
}

/**
 * Returns if a token is dead.
 * A token is dead if:
 * (a) is a NPC at 0 HP and the NPCsJustDie setting is enabled
 * (b) has been set as dead in combat (e.g. it has the skull icon, icon may vary from system to system) and the showDead setting is enabled
 * (c) has the healthEstimate.dead flag, which is set by a macro.
 * @param {TokenDocument} token 
 * @param {Integer} stage 
 * @returns {Boolean}
 */
export function isDead(token, stage) {
	return (NPCsJustDie && !token.actor.hasPlayerOwner && stage === 0) || (showDead && Array.from(token.actor.effects.values()).some(x => x.data.icon === deathMarker)) || token.document.getFlag('healthEstimate', 'dead');
}

/**
 * Updates the variables if any setting was changed.
 */
export function updateSettings () {
	useColor = sGet('core.menuSettings.useColor');
	descriptions = sGet('core.stateNames').split(/[,;]\s*/);
	smooth = sGet('core.menuSettings.smoothGradient');
	deathStateName = sGet('core.deathStateName');
	showDead = sGet('core.deathState');
	NPCsJustDie = sGet('core.NPCsJustDie');
	deathMarker = sGet('core.deathMarker');
	colors = sGet('core.variables.colors');
	outline = sGet('core.variables.outline');
	deadColor = sGet('core.variables.deadColor');
	deadOutline = sGet('core.variables.deadOutline');
	perfectionism = sGet('core.perfectionism');
	outputChat = sGet('core.outputChat');

	const margin = `${sGet('core.menuSettings.positionAdjustment')}em`;
	const alignment = sGet('core.menuSettings.position');
	document.documentElement.style.setProperty('--healthEstimate-margin', margin);
	document.documentElement.style.setProperty('--healthEstimate-alignment', alignment);
	document.documentElement.style.setProperty('--healthEstimate-text-size', sGet('core.menuSettings.fontSize'));
}

/**
 * Creates the Overlay with the text on mouse over.
 */
class HealthEstimateOverlay extends BasePlaceableHUD {
	static get defaultOptions () {
		const options = super.defaultOptions;
		options.classes = options.classes.concat(['healthEstimate', 'healthEstimateColor']);
		options.template = 'modules/healthEstimate/templates/healthEstimate.hbs';
		options.id = 'healthEstimate';
		return options;
	}
	
	/**
	 * Sets the position of the overlay.
	 * This override is needed because the overlay goes off-center on Hexagonal Rows grid types.
	 * See https://github.com/mclemente/healthEstimate/issues/19 for visual examples.
	 */
	setPosition({left, top, width, height, scale}={}) {
		if (canvas.grid.type === 2 || canvas.grid.type === 3) {
			left = (left ?? this.object.x) - 6;
		}
		super.setPosition({left, top, width, height, scale});
	}

	getData () {
		const data = super.getData();
		data.status = this.estimation;
		return data;
	}
}

export class HealthEstimate {
	constructor () {
		updateBreakSettings();
		canvas.hud.HealthEstimate = new HealthEstimateOverlay();
		updateSettings();
		this.initHooks();
	}

	initHooks () {
		Hooks.on('hoverToken', (token, hovered) => {
			this._handleOverlay(token, hovered);
		});

		Hooks.on('deleteToken', (...args) => {
			canvas.hud.HealthEstimate.clear();
		});
		
		Hooks.on('updateToken', (scene, token, ...args) => {
			if (canvas.hud.HealthEstimate !== undefined && canvas.hud.HealthEstimate.object) {
				if (token._id === canvas.hud.HealthEstimate.object.id) {
					canvas.hud.HealthEstimate.clear();
				}
			}
		});
	}

	_handleOverlay (token, hovered) {
		if (!token.actor) {
			return;
		}
		if (breakOverlayRender(token) || (!game.user.isGM && token.actor.getFlag('healthEstimate', 'hideHealthEstimate'))) {
			return;
		}
		const width = `${canvas.scene.data.grid * token.data.width}px`;
		document.documentElement.style.setProperty('--healthEstimate-width', width);

		if (hovered) {
			this._getEstimation(token);
			canvas.hud.HealthEstimate.bind(token);
		}
		else {
			canvas.hud.HealthEstimate.clear();
		}
	}

	_getEstimation (token) {
		const fraction = Math.min(fractionFormula(token), 1);
		const stage = Math.max(0,
			perfectionism ?
			Math.ceil((descriptions.length - 2 + Math.floor(fraction)) * fraction) :
			Math.ceil((descriptions.length - 1) * fraction),
		);
		const colorIndex = Math.max(0, Math.ceil((colors.length - 1) * fraction));
		let desc, color, stroke;

		desc = descriptionToShow(descriptions, stage, token, {
			isDead: isDead(token, stage),
			desc : deathStateName,
		}, fraction);
		color = colors[colorIndex];
		stroke = outline[colorIndex];
		if (isDead(token, stage)) {
			color = deadColor;
			stroke = deadOutline;
		}
		document.documentElement.style.setProperty('--healthEstimate-stroke-color', stroke);
		document.documentElement.style.setProperty('--healthEstimate-text-color', color);
		canvas.hud.HealthEstimate.estimation = {desc};
	}
}