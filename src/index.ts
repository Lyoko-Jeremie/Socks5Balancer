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

import {isString} from 'lodash';

console.log(process.argv)
if (isString(process.argv[2])) {
  // tslint:disable-next-line:no-string-literal
  process.env['globalConfigFilePath'] = process.argv[2];
}

import {initUpstreamPool} from './upstreamPool';
import {initServer} from './server';
import {startHttpStateServer} from './stateServer/simpleHttp';

initUpstreamPool();
initServer();
startHttpStateServer();
