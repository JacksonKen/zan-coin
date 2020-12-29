import { Player } from '@server/world/actor/player/player';
import { Position } from '@server/world/position';
import { Subject, timer } from 'rxjs';
import { World } from '@server/world';
import { LocationObject } from '@runejs/cache-parser';
import { Npc } from '@server/world/actor/npc/npc';
import { QuestRequirement } from '@server/plugins/plugin';
import { getFiles } from '@server/util/files';
import { logger } from '@runejs/core';
import { pluginActions } from '@server/game-server';

export type ActionCancelType = 'manual-movement' | 'pathing-movement' | 'generic' | 'keep-widgets-open' | 'button' | 'widget';

/**
 * A type of action where something is being interacted with.
 */
export interface InteractingAction {
    interactingObject?: LocationObject;
}

/**
 * A type of action that loops until either one of three things happens:
 * 1. A player is specified within `options` who's `actionsCancelled` event has been fired during the loop.
 * 2. An npc is specified within `options` who no longer exists at some point during the loop.
 * 3. The `cancel()` function is manually called, presumably when the purpose of the loop has been completed.
 * @param options Options to provide to the looping action, which include:
 * `ticks` the number of game ticks between loop cycles. Defaults to 1 game tick between loops.
 * `delayTicks` the number of game ticks to wait before starting the first loop. Defaults to 0 game ticks.
 * `player` the player that the loop belongs to. Providing this field will cause the loop to cancel if this
 *          player's `actionsCancelled` is fired during the loop.
 * `npc` the npc that the loop belongs to. This will Providing this field will cause the loop to cancel if
 *       this npc is flagged to no longer exist during the loop.
 */
export const loopingAction = (options?: { ticks?: number, delayTicks?: number, npc?: Npc, player?: Player }):
        { event: Subject<void>, cancel: () => void } => {
    if(!options) {
        options = {};
    }

    const { ticks, delayTicks, npc, player } = options;
    const event: Subject<void> = new Subject<void>();

    const subscription = timer(delayTicks === undefined ? 0 : (delayTicks * World.TICK_LENGTH),
        ticks === undefined ? World.TICK_LENGTH : (ticks * World.TICK_LENGTH)).subscribe(() => {
        if(npc && !npc.exists) {
            event.complete();
            subscription.unsubscribe();
            return;
        }

        event.next();
    });

    let actionCancelled;

    if(player) {
        actionCancelled = player.actionsCancelled.subscribe(() => {
            subscription.unsubscribe();
            actionCancelled.unsubscribe();
            event.complete();
        });
    }

    return { event, cancel: () => {
        subscription.unsubscribe();

        if(actionCancelled) {
            actionCancelled.unsubscribe();
        }

        event.complete();
    } };
};

/**
 * A walk-to type of action that requires the specified player to walk to a specific destination before proceeding.
 * Note that this does not force the player to walk, it simply checks to see if the player is walking where specified.
 * @param player The player that must walk to a specific position.
 * @param position The position that the player needs to end up at.
 * @param interactingAction [optional] The information about the interaction that the player is making. Not required.
 * @TODO change to 600ms / 1 check per game cycle?
 */
export const walkToAction = async (player: Player, position: Position, interactingAction?: InteractingAction): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
        player.walkingTo = position;

        const inter = setInterval(() => {
            if(!player.walkingTo || !player.walkingTo.equals(position)) {
                reject();
                clearInterval(inter);
                return;
            }

            if(!player.walkingQueue.moving()) {
                if(!interactingAction) {
                    if(player.position.distanceBetween(position) > 1) {
                        reject();
                    } else {
                        resolve();
                    }
                } else {
                    if(interactingAction.interactingObject) {
                        const locationObject = interactingAction.interactingObject;
                        if(player.position.withinInteractionDistance(locationObject)) {
                            resolve();
                        } else {
                            reject();
                        }
                    }
                }

                clearInterval(inter);
                player.walkingTo = null;
            }
        }, 100);
    });
};

export const ACTION_DIRECTORY = './dist/world/action';

export const getActionList = (key: ActionType): any[] => pluginActions[key];

class ActionHandler {

    handlerMap = new Map<string, any>();

    get(action: ActionType): any {
        this.handlerMap.get(action.toString());
    }

    call(action: ActionType, ...args: any[]): void {
        const actionHandler = this.handlerMap.get(action.toString());
        if(actionHandler) {
            try {
                actionHandler(...args);
            } catch(error) {
                logger.error(`Error handling action ${ action.toString() }`);
                logger.error(error);
            }
        }
    }

    register(action: ActionType, actionHandler: (...args: any[]) => void): void {
        this.handlerMap.set(action.toString(), actionHandler);
    }

}

export const actionHandler = new ActionHandler();

export async function loadActions(): Promise<void> {
    const blacklist = [];

    for await(const path of getFiles(ACTION_DIRECTORY, blacklist)) {
        if(path.indexOf('.map') !== -1) {
            continue;
        }

        const location = '.' + path.substring(ACTION_DIRECTORY.length).replace('.js', '');

        try {
            const importedAction = require(location)?.default || null;
            if(importedAction && importedAction.action && importedAction.handler) {
                actionHandler.register(importedAction.action, importedAction.handler);
            }
        } catch(error) {
            logger.error(`Error loading action file at ${location}:`);
            logger.error(error);
        }
    }

    return Promise.resolve();
}

export interface Action {
    // The type of action to perform.
    type: ActionType;
    // The action's priority over other actions.
    priority?: number;
    // [optional] Details regarding what quest this action is for.
    questRequirement?: QuestRequirement;
}

export type ActionType =
    'button'
    | 'widget_action'
    | 'item_on_item'
    | 'item_action'
    | 'equip_action'
    | 'world_item_action'
    | 'npc_action'
    | 'object_action'
    | 'item_on_object'
    | 'item_on_npc'
    | 'player_command'
    | 'player_init'
    | 'npc_init'
    | 'quest'
    | 'player_action'
    | 'swap_items'
    | 'move_item';
