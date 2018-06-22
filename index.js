const axios = require('axios')
const https = require('https')
const fs = require('fs')
const qs = require('qs')
var agent = new https.Agent({
  ca: fs.readFileSync('cacert.pem')
})

const TOKEN = process.env.TOKEN || fs.readFileSync('token.txt', 'utf-8')

async function sendPOST(method, data) {
  Log('Sending ' + method + '...')
  const res = await axios({
    method: 'POST',
    url: 'https://community.steam-api.com/' + method + '/v0001/',
    agent: agent,
    headers: {
      Accept: '*/*',
      'Content-type': 'application/x-www-form-urlencoded',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3464.0 Safari/537.36',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Origin: 'https://steamcommunity.com',
      Referer: 'https://steamcommunity.com/saliengame/play'
    },
    data: qs.stringify({ access_token: TOKEN, ...data })
  })
  return res.data.response
}

async function sendGET(method, data) {
  Log('Sending ' + method + '...')
  const res = await axios({
    method: 'get',
    url:
      'https://community.steam-api.com/ITerritoryControlMinigameService/' +
      method +
      '/v0001/?access_token=' +
      TOKEN +
      '&' +
      data,
    agent: agent,
    headers: {
      Accept: '*/*',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Origin: 'https://steamcommunity.com',
      Referer: 'https://steamcommunity.com/saliengame/play'
    }
  })
  return res.data.response
}

async function GetFirstAvailablePlanet() {
  const { planets } = await sendGET('GetPlanets', 'active_only=1')

  if (!planets) {
    return null
  }
  const planet = planets.find(p => !p.state.captured)

  Log('Found planet: ' + planet.id)
  return planets.find(p => !p.state.captured).id
}

async function GetFirstAvailableZone(id) {
  const { planets } = await sendGET('GetPlanet', 'id=' + id)

  if (!planets[0].zones) {
    return null
  }

  const zones = planets[0].zones
  let cleanZones = zones.filter(z => !z.captured && z.capture_progress < 0.95)

  if (!cleanZones) {
    return null
  }
  cleanZones = cleanZones.sort((a, b) => {
    if (b['difficulty'] === a['difficulty']) {
      return b['zone_position'] - a['zone_position']
    }
    return b['difficulty'] - a['difficulty']
  })
  return cleanZones[0]
}

function GetScoreForZone(zone) {
  let score = 0
  switch (zone['difficulty']) {
    case 1:
      score = 5
      break
    case 2:
      score = 10
      break
    case 3:
      score = 20
      break
  }
  return score * 120 - score
}

async function GetPlayerInfo() {
  const pInfo = await sendPOST(
    'ITerritoryControlMinigameService/GetPlayerInfo',
    null
  )
  return pInfo
}

async function JoinPlanet(id) {
  await sendPOST('ITerritoryControlMinigameService/JoinPlanet', { id })
  Log('Joined planet: ' + id)
}

async function JoinZone(zone) {
  await sendPOST('ITerritoryControlMinigameService/JoinZone', {
    zone_position: zone.zone_position
  })
  Log(
    'Joined zone ' +
      zone.zone_position +
      ' - Captured: ' +
      Math.floor(zone.capture_progress * 100) +
      '% - Difficulty: ' +
      zone.difficulty
  )
}

async function LeaveGame(gameid) {
  await sendPOST('IMiniGameService/LeaveGame', {
    gameid
  })
  Log('Left Game: ' + gameid)
}

async function ReportScore(zone) {
  await sendPOST('ITerritoryControlMinigameService/ReportScore', {
    score: GetScoreForZone(zone)
  }).then(scoreReport => {
    if (scoreReport.new_score) {
      Log(
        'Match ended score: ' +
          scoreReport.old_score +
          ' => ' +
          scoreReport.new_score +
          ' (next level: ' +
          scoreReport.next_level_score +
          ') - Current level: ' +
          scoreReport.new_level
      )
    }
  })
}

function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function Log(msg) {
  console.log(`[${new Date().toUTCString()}] - ${msg}`)
}

async function init() {
  const id = await GetFirstAvailablePlanet()

  let currentPlanet
  await JoinPlanet(id)

  const pInfo = await GetPlayerInfo()

  currentPlanet = pInfo.active_planet

  if (pInfo.active_zone_game) {
    Log('Already in a game. Leaving: ' + pInfo.active_zone_game)
    LeaveGame(pInfo.active_zone_game)
  }

  while (true) {
    let zone = await GetFirstAvailableZone(currentPlanet)
    await JoinZone(zone)
    await timeout(120000)
    ReportScore(zone)
  }
}

init()
require('http')
  .createServer()
  .listen(3000)
