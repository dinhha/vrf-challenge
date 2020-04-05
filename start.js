const request = require('request-promise');
const cheerio = require('cheerio');
const _ = require('lodash');
const fs = require('fs');
const { GoogleSpreadsheet } = require('google-spreadsheet');
// const moment = require('moment');
const moment = require('moment-timezone');

const activitiesFile = './activities.json';
const docId = "1b3SIEiokIkymHvNkaSjfjMTo6c8m8UZ0hzS-IiHEjU0";

const Activity = require('./activity');

const startDate = new Date("2020-03-19 17:00 GMT+07:00");
const endDate = new Date("2020-04-04 23:59 GMT+07:00");


/** @type { [Activity] } */
let clubActivities;

const skipLoadStrava = true;

// load(new Date('2020-02-17 10:07:25 UTC'));

const _excludedIds = [
    '/athletes/48657023'
];


(async function main () {

    // return await loadFBJoinList();

    run(skipLoadStrava);

    setInterval(() => {
        run();
    }, 1*3600000);
    
})();

async function run(stop = false) {

    const activitiesData = fs.readFileSync(activitiesFile, 'utf8') || [];
    clubActivities = _.chain(JSON.parse(activitiesData)).map(a => new Activity(a)).sortBy(a => -a.startTime).value();

    // _.forEach(clubActivities, activity => {
    //     // if (activity.time == 0) {
    //     //     let pace = _.replace(activity.pace, /([\d]+\:[\d]+).*/, "$1");
    //     //     let paceMin = moment.duration('0:' + pace).asMinutes();
    //     //     let time = paceMin * activity.distance;
    //     //     activity.time = time;
    //     // }
    // });

    // return await store(clubActivities);


    let fromDate = new Date(), lastAct;
    while (!stop) {
        // if (_.size(clubActivities) > 0) {
        //     fromDate = moment(_.last(clubActivities).startTime).add(3, 'hours').toDate();
        // }

        const activities = await load(fromDate, lastAct);


        if (_.isEmpty(activities)) {
            stop = true;
        } else {

            await store(activities);

            lastAct = _.minBy(activities, a => a.updatedAt.getTime());
            fromDate = lastAct.updatedAt;
        }
    }

    await storeDoc(clubActivities);

}

/**
 * @param { [Activity] } activities 
 */
async function storeDoc(activities) {
    try {
        const doc = new GoogleSpreadsheet(docId);
    
        await doc.useServiceAccountAuth(require('./credentials.json'));
    
        await doc.loadInfo();

        const daysHeader = [];
    
        for (let date = startDate; date.getTime() <= endDate.getTime();) {
            daysHeader.push(moment(date).format('DD/MM/YY'));
            date = moment(date).add(1, 'day').toDate();
        }

        let sheet = doc.sheetsByIndex[0];
        const headerFields = {
            name: "Tên",
            strava: 'Strava',
            totalDays: "Tổng số buổi > 5km",
            morningCnt: "Số buổi chạy từ trước 6h30",
            totalKm: "Tổng Km",
            join: "Join",
        }
        const headers = [headerFields.name, headerFields.strava, headerFields.join, headerFields.totalKm, headerFields.morningCnt, headerFields.totalDays, ...daysHeader];


        if (sheet.title != "ranking") {
            sheet = await doc.addSheet({
                title: 'ranking',
                headers: headers
            });

            await doc.deleteSheet(doc.sheetsByIndex[0].sheetId);
        } else {
            await sheet.clear();
            await sheet.setHeaderRow(headers);
        }

        let byAthletes = _.chain(activities)
            .filter(a => _excludedIds.includes(a.athleteLink) == false)
            .groupBy(a => _.trim(a.athleteName).toLowerCase())
            .value();

        let validActivities = [];
        _.forEach(byAthletes, activities => {
            let sorted = _.sortBy(activities, a => a.startTime != null ? a.startTime.getTime() : 0);
            let valid = [];
            
            for (let i = 0; i < sorted.length; i++) {
                const activity = sorted[i];
                valid.push(activity);

                if (i <= sorted.length - 2) {
                    const next = sorted[i + 1];
                    const startTime1 = activity.startTime && activity.startTime.getTime() || 0;
                    const startTime2 = next.startTime && next.startTime.getTime() || 0;
                    
                    if (startTime1 + activity.time * 60000 >= startTime2) {
                        next.invalid = true;
                        valid.push(next);
                        console.log(activity, next);
                        i += 1;
                    }
                }
            }

            validActivities.push(...valid);
        });

        await store(validActivities);

        byAthletes = _.groupBy(validActivities, a => _.trim(a.athleteName).toLowerCase());

        let morningDays = {};
        let rows = [];
        _.forEach(byAthletes, (athleteActivities) => {
            let validActivities = _.filter(athleteActivities, a => a.invalid != true);

            if (_.size(validActivities) > 0) {


                const byDays = _.groupBy(validActivities, a => moment(a.startTime).format('DD/MM/YY'));
                let row = {
                    [headerFields.name]: validActivities[0].athleteName,
                    [headerFields.strava]: validActivities[0].athleteLink ? "https://strava.com" + validActivities[0].athleteLink : "",
                    [headerFields.totalDays]: 0,
                    [headerFields.totalKm]: 0,
                    [headerFields.morningCnt]: 0,
                };

                row[headerFields.totalKm] = _.chain(validActivities).sumBy(a => a.distance || 0).value();
    
                _.forEach(daysHeader, day => {
                    const dayActivities = byDays[day];
                    const max = _.chain(dayActivities).maxBy(a => a.distance).value();
                    
                    row[day] = _.chain(dayActivities).sumBy(a => a.distance || 0).value() || 0;

                    if (max != null) {
                        row[headerFields.totalDays] += (max.distance >= 5 ? 1 : 0);
                    }

                    let morningCounted = false;

                    _.forEach(dayActivities, act => {
                        if (act.startTime && morningCounted == false) {
                            const _4h00 = moment.tz(act.startTime, 'Asia/Ho_Chi_Minh').hour(3).minute(0).second(0).toDate();
                            const _6h30 = moment.tz(act.startTime, 'Asia/Ho_Chi_Minh').hour(6).minute(30).second(0).toDate();

                            if (act.distance >= 5 && act.startTime.getTime() <= _6h30.getTime() && act.startTime.getTime() >= _4h00.getTime()) {
                                row[headerFields.morningCnt] ++;
                                morningCounted = true;
                                morningDays[day] = (morningDays[day] || 0) + 1;
                            }
                        }
                    });
                });
                rows.push(row);
                // console.log(row);
            }
        });
    
        rows = _.sortBy(rows, 
            r => r[headerFields.morningCnt] >= 4 ? -r[headerFields.totalDays] : - (r[headerFields.totalDays] - 1000),
            r => -r[headerFields.morningCnt], 
            r => -r[headerFields.totalKm]
        );
        console.log(rows.length, activities.length);
        console.log(morningDays);

        await sheet.addRows(rows);

        const len = rows.length;
        await sheet.loadCells(`C2:C${len+1}`);
        for (let i = 1; i <= len; i++) {
            const lookupFormula = `=if(VLOOKUP(A${i + 1};'fb join'!$C$2:$C$200;1;false)=A${i + 1};true;false)`;
            const cell = sheet.getCell(i, 2);
            cell.formula = lookupFormula;
        }
        await sheet.saveUpdatedCells();
        
    } catch (err) {
        console.log(err);
    }
}

/**
 * @param { [Activity] } activities 
 */
async function store(activities) {
    try {
        clubActivities = _.chain([...clubActivities, ...activities])
            .uniqBy(a => a.link)
            .sortBy(a => -a.startTime)
            .value();

        fs.writeFileSync(activitiesFile, JSON.stringify(clubActivities, null, 2));

    } catch (err) {
        console.log(activities);
    }
}

/**
 * @returns {Promise<[Activity]>}
 * @param {Date} date 
 * @param {Activity} lastAct
 */
async function load(date, lastAct = null) {
    try {
        console.log("....Fetching before", date);

        const time = parseInt(date.getTime() / 1000);
        let cursor = time;

        // if (lastAct && lastAct.time > 0) {
        //     cursor = time + lastAct.time*60;
        // }

        const url = `https://www.strava.com/clubs/586999/feed?feed_type=club&before=${time}&cursor=${cursor}`;
        const userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.116 Safari/537.36";
        const userCookie = fs.readFileSync('./cookie.txt');

        console.log(url);


        const response = await request.get(url, {
            headers: {
                cookie: userCookie,
                'user-agent': userAgent
            },
        });

        console.log("Loaded ", response.length);

        const $ = cheerio.load(response);
        const activityEntries = $('.entity-details.feed-entry');
        const activities = [];

        // console.log(activityEntries.length, response.match(/entity-details feed-entry/g));

        activityEntries.each((i, el) => {
            const $el = $(el);
            const athleteName = $el.find('.entry-head .entry-athlete').text();
            const athleteLink = $el.find('.entry-head .entry-athlete').attr('href');
            const title = $el.find('.entry-body .entry-title a').text();
            const link = $el.find('.entry-body .entry-title a').attr('href');
            let updatedAt = $el.data('updated-at');
            let distance, pace, time, startTime;

            distance = $el.find('.list-stats').find('li[title="Distance"]').text();
            pace = $el.find('.list-stats').find('li[title="Pace"]').text();
            time = $el.find('.list-stats').find('li[title="Time"]').text();

            const isGroupEntries = $el.parent().is('.list-entries') == true;

            if ($el.find('.entry-head time') != null) {
                startTime = $el.find('.entry-head time').attr('datetime');
            }

            if (startTime == null && isGroupEntries) {
                const $parent = $el.parents('.group-activity');
                updatedAt = $parent.data('updated-at');
                startTime = $parent.find('.entry-container .entry-head time').attr('datetime');
            }

            const activity = new Activity({
                athleteName: _.chain(athleteName).replace('Summit Member', '').trim().value(),
                athleteLink,
                title: _.trim(title),
                link,
                startTime,
                distance,
                pace,
                time,
                updatedAt: new Date(parseInt(updatedAt) * 1000)
            });

            console.log(activity);
            activities.push(activity);
        });

        console.log(activities.length, 'activities');

        return _.sortBy(activities, a => -a.startTime);

    } catch (err) {
        console.log(err);
    }
}

async function loadFBJoinList() {
    try {
        const html = fs.readFileSync('./fb1.html', 'utf8');
        const $ = cheerio.load(html);
        const list = $('ul._7791 li');

        let joinList = {};
        console.log(list.length);

        const getJoinUser = function (commentEl, reply = false) {
            const $row = $(commentEl);
            let $cmt = reply == true ? $row.find('div[aria-label="Comment reply"]') : $row.find('div[aria-label="Comment"]');
            const $link = $cmt.find('a[aria-hidden="true"]');
            const name = $link.find('img').attr('alt');
            const fbLink = $link.attr('href');
            const cmtContent = $cmt.find('span[dir="ltr"]').text();

            if (_.toLower(cmtContent).indexOf('tham gia') >= 0) {
                const user = {
                    name: _.trim(name),
                    link: 'https://facebook.com' + _.replace(fbLink, /comment_id=.*$/, '').replace(/[\?\&]$/, ''),
                    comment: cmtContent
                };
                console.log(user);

                joinList[user.link] = user;

                return user;
            }
        }

        list.each((i, el) => {
            const $row = $(el);
            const joined = getJoinUser(el);

            const $replyList = $row.find('>div>ul');
            if ($replyList.length > 0) {
                $replyList.find(">li").each((_, reply) => {
                    const $rep = $(reply);

                    // console.log($rep.text())
                    const replyJoin = getJoinUser(reply, true);
                });
            }
        });

        console.log(_.size(joinList))

        const doc = new GoogleSpreadsheet(docId);

        await doc.useServiceAccountAuth(require('./credentials.json'));

        await doc.loadInfo();

        let sheet = doc.sheetsByIndex[1];
        const headerFields = {
            name: "Tên",
            link: "Link Fb",
            strava: "Strava",
            comment: "Comment"
        }
        const headers = [
            headerFields.name,
            headerFields.link,
            headerFields.strava,
            headerFields.comment
        ];

        let oldRows = await sheet.getRows();
        let stravaByName = {};
        let oldUsers = {};
        let rows = [];

        _.forEach(oldRows, row => {
            const strava = row[headerFields.strava];
            const name = _.trim(row[headerFields.name]);
            oldUsers[name] = true;

            if (strava) {
                stravaByName[name] = strava;
            }

            rows.push({
                [headerFields.name]: name,
                [headerFields.link]: row[headerFields.link],
                [headerFields.strava]: strava,
                [headerFields.comment]: row[headerFields.comment],
            })
        });

        1;

        _.forEach(joinList, user => {
            if (!oldUsers[user.name]) {
                rows.push({
                    [headerFields.name]: user.name,
                    [headerFields.link]: user.link,
                    [headerFields.strava]: stravaByName[user.name],
                    [headerFields.comment]: user.comment,
                });
            }
        });
        console.log(_.size(rows));
        await sheet.clear();
        await sheet.setHeaderRow(headers);


        await sheet.addRows(rows);
        
    } catch (err) {
        console.log(err);
    }
}