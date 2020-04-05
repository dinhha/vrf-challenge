const _ = require('lodash');
const moment = require('moment');

module.exports = class Activity {
    constructor({
        athleteName,
        athleteLink,
        title,
        link,
        startTime,
        distance,
        pace,
        time,
        invalid,
        updatedAt
    }) {
        this.athleteName = athleteName;
        this.athleteLink = athleteLink;
        this.title = title;
        this.link = link;
        this.startTime = new Date(startTime);
        this.distance = parseFloat(_.replace(distance, /[^\d\.,]/g, ''));
        this.pace = pace;
        this.time = 0;
        this.invalid = invalid == true;
        this.updatedAt = updatedAt;

        if (typeof time == 'number') {
            this.time = time;
        } else {
            let duration = time;
            if (_.indexOf(time, 'h') == -1) duration = '0h' + time;
            else if (_.indexOf(time, 's') == -1) duration = time + '0s';

            duration = _.replace(duration, /[^\d]+/g, ':').replace(/\:$/, '');

            this.time = moment.duration(duration).asMinutes();
        }

        // if (this.startTime)
    }
}