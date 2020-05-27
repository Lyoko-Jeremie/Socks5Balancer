/**
 * Socks5Balancer : A Simple TCP Socket Balancer for balance Multi Socks5 Proxy Backend
 * Copyright (C) <2020>  <Jeremie>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import {testSocks5, testTcp} from './BackendTester';
import {globalConfig} from './configLoader';
import {Subscription, timer} from 'rxjs';
import moment from 'moment';
import {assign, isString} from 'lodash';
import bluebird from 'bluebird';

export enum UpstreamSelectRule {
  loop = 'loop',
  random = 'random',
}

// tslint:disable-next-line:prefer-const
let upstreamSelectRule: UpstreamSelectRule | undefined =
  globalConfig.get('upstreamSelectRule', UpstreamSelectRule.random);

interface UpstreamInfo {
  host: string;
  port: number;
  lastOnlineTime: moment.Moment;
  lastConnectAble: moment.Moment;
  lastConnectCheckResult?: string | any;
  isOffline?: boolean;
}

const defaultUpstreamInfo: Omit<UpstreamInfo, 'host' | 'port'> = {
  lastOnlineTime: moment(),
  lastConnectAble: moment(),
};

let lastActiveTime: moment.Moment | undefined = undefined;

export function checkNeedSleep() {
  const sleepTime = globalConfig.get('sleepTime', 30 * 60 * 1000);
  if (lastActiveTime) {
    if (moment().diff(lastActiveTime) > sleepTime) {
      endCheckTimer();
      return true;
    }
  }
  return false;
}

// The servers we will proxy to
let upstreamServerAddresses: UpstreamInfo[] = [];

export function initUpstreamPool() {
  upstreamServerAddresses = globalConfig.get('upstream', upstreamServerAddresses);
  upstreamServerAddresses = upstreamServerAddresses.filter(v => v.host && v.port)
    .map(v => assign(v, defaultUpstreamInfo));
  if (upstreamServerAddresses.length === 0) {
    console.error('initUpstreamPool (upstreamServerAddresses.length === 0)');
    throw new Error('initUpstreamPool (upstreamServerAddresses.length === 0)');
  }
  startCheckTimer();
}

export function updateActiveTime() {
  lastActiveTime = moment();
  startCheckTimer();
}

export function updateOnlineTime(u: UpstreamInfo) {
  u.isOffline = false;
  u.lastOnlineTime = moment();
}

let lastUseUpstreamIndex = 0;

// This is where you pick which server to proxy to
// for examples sake, I choose a random one
export function getServerBasedOnAddress(host: string | undefined) {

  const getNextServer = () => {
    const _lastUseUpstreamIndex = lastUseUpstreamIndex;
    while (true) {
      if (!upstreamServerAddresses[lastUseUpstreamIndex].isOffline) {
        return upstreamServerAddresses[lastUseUpstreamIndex];
      }
      ++lastUseUpstreamIndex;
      if (lastUseUpstreamIndex >= upstreamServerAddresses.length) {
        lastUseUpstreamIndex = 0;
      }
      if (_lastUseUpstreamIndex === lastUseUpstreamIndex) {
        // cannot find
        return undefined;
      }
    }
  };

  let s: UpstreamInfo | undefined = undefined;
  switch (upstreamSelectRule) {
    case UpstreamSelectRule.loop:
      s = getNextServer();
      console.log('getServerBasedOnAddress:', s);
      return s;
    case UpstreamSelectRule.random:
    default:
      s = upstreamServerAddresses[Math.floor((Math.random() * upstreamServerAddresses.length))];
      console.log('getServerBasedOnAddress:', s);
      return s;
  }
}

let tcpCheckTimer: Subscription | undefined = undefined;
let connectCheckTimer: Subscription | undefined = undefined;

export function endCheckTimer() {
  if (tcpCheckTimer) {
    tcpCheckTimer.unsubscribe();
    tcpCheckTimer = undefined;
  }
  if (connectCheckTimer) {
    connectCheckTimer.unsubscribe();
    connectCheckTimer = undefined;
  }
}

export function startCheckTimer() {
  if (tcpCheckTimer && connectCheckTimer) {
    return;
  }
  endCheckTimer();
  console.log('now to startCheckTimer.');
  let tcpCheckStart = globalConfig.get('tcpCheckStart', 0);
  if (tcpCheckStart < 100) {
    tcpCheckStart = 1000;
  }
  let tcpCheckPeriod = globalConfig.get('tcpCheckPeriod', 0);
  if (tcpCheckPeriod < 100) {
    tcpCheckPeriod = 5 * 1000;
  }
  let connectCheckStart = globalConfig.get('connectCheckStart', 0);
  if (connectCheckStart < 100) {
    connectCheckStart = 5 * 60 * 1000;
  }
  let connectCheckPeriod = globalConfig.get('connectCheckPeriod', 0);
  if (connectCheckPeriod < 100) {
    connectCheckPeriod = 15 * 1000;
  }
  tcpCheckTimer = timer(tcpCheckStart, tcpCheckPeriod).subscribe(value => {
    if (checkNeedSleep()) return;
    bluebird.all(upstreamServerAddresses.map(u => testTcp(u.host, u.port)))
      .then(A => {
        // the testTcp resolve true if ok, resolve false if error
        // we wait all resolve, then check result one by one
        if (A.length === upstreamServerAddresses.length) {
          const t = moment();
          for (let i = 0; i !== A.length; ++i) {
            if (A[i]) {
              upstreamServerAddresses[i].lastOnlineTime = t;
              upstreamServerAddresses[i].isOffline = false;
            } else {
              upstreamServerAddresses[i].isOffline = true;
            }
          }
        }
      });
  });
  connectCheckTimer = timer(connectCheckStart, connectCheckPeriod).subscribe(value => {
    if (checkNeedSleep()) return;
    const testRemoteHost = globalConfig.get('testRemoteHost', undefined);
    const testRemotePort = globalConfig.get('testRemotePort', undefined);
    const A = upstreamServerAddresses.map(u => bluebird.resolve(testSocks5(u.host, u.port, testRemoteHost, testRemotePort)));
    bluebird.all(A)
      .finally(() => {
        // the testSocks5 return string if ok, return reject if error
        // we only wait all complete, then check complete state one by one
        if (A.length === upstreamServerAddresses.length) {
          const t = moment();
          for (let i = 0; i !== A.length; ++i) {
            if (A[i].isResolved()) {
              upstreamServerAddresses[i].lastConnectCheckResult = A[i].value();
              upstreamServerAddresses[i].lastConnectAble = t;
            }
          }
        }
      });
  });
}
