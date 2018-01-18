var rp = require('request-promise');
var moment = require('moment');
var parser = require('vdata-parser');

module.exports.returnStandupData = (req, res, Standup) => {
	var date = req.query.date ? moment(req.query.date) : moment();
	Standup.findOne({
        where: {
            createdAt: {
                $between: [date.startOf('day').toDate(), date.endOf('day').toDate()]
            }
        }
    }).then(standup => {
        Standup.findOne({
            where: {
                createdAt: {
                    $lt: date.startOf('day').toDate()
                }
            },
            order: [[ 'createdAt', 'DESC']]
        }).then(prevStandup => {
            if (standup && standup.data)
                res.json([standup, prevStandup]);
            else
                res.json(['No standup data found.', prevStandup]);
            });
	});
};

module.exports.returnUserList = (req, res, Users) => {
    Users.findAll()
    .then(users => {
        res.json(users);
    });
};

module.exports.returnDiffs = (req, res, Users) => {
    var options = [rp({
        uri: process.env.PHAB_URL + '/api/differential.revision.search',
        qs: {
            "api.token": process.env.PHAB_TOKEN,
            "queryKey": process.env.PHAB_LANDED_DIFFS_QUERY_ID,
        }
    }), rp({
        uri: process.env.PHAB_URL + '/api/differential.revision.search',
        qs: {
            "api.token": process.env.PHAB_TOKEN,
            "queryKey": process.env.PHAB_INREVIEW_DIFFS_QUERY_ID,
        }
    })];
    Promise.all(options).then(resArray => {
        var response = [];
        var users = [];
        resArray.forEach(phabRes => {
            phabRes = JSON.parse(phabRes);
            var userList = phabRes.result.data.slice(0,5).map(diff => {
                users.push(Users.findOne({where:{phab:diff.fields.authorPHID}}));
            })
        });
        Promise.all(users).then(userResponses => {
            resArray.forEach(phabRes => {
                phabRes = JSON.parse(phabRes);
                var data = phabRes.result.data.slice(0,5).map(diff => {
                    var author = userResponses.find(user => {
                        if (!user)
                            return false;
                        return user.phab == diff.fields.authorPHID});
                    return {
                        id: diff.id,
                        url: process.env.PHAB_URL + '/D' + diff.id,
                        title: diff.fields.title,
                        author: author ? author.trello : null
                    };
                });
                response.push(data);
            });
            res.json(response);
        });
    });
};

module.exports.returnTimeOff = (req, res, Users) => {
    rp(process.env.OOO_CALENDAR_FEED).then(calRes => {
        var response = [];
        var eventArray = parser.fromString(calRes).VCALENDAR.VEVENT;
        eventArray.forEach(event => {
          var startTime = moment(event.DTSTART.value)
          if (startTime.unix() > moment().unix() && startTime.unix() < moment().add(14, 'days').unix()) {
            response.push({
                name: event.SUMMARY.substr(0, event.SUMMARY.indexOf('(') - 1),
                start: startTime.format('M/D'),
                end: moment(event.DTEND.value).format('M/D'),
            });
          }
        });
        res.send(response);
    });
}


