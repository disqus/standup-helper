var rp = require('request-promise');
var Bluebird = require('bluebird');
var moment = require('moment');
var parser = require('vdata-parser');

var BOT_NAME = 'Trello Standups'

var trello = path => {return `https://api.trello.com/1/${path}?key=${process.env.SH_TRELLO_KEY}&token=${process.env.SH_TRELLO_TOKEN}`;}

// Start standups
module.exports.beginStandup = (req, res, Standup, Users, Boards) => {
  var requests = [];
  Boards.findAll()
  .then(boards => {
    var boardArray = boards.map(board => {return board.dataValues});
    boardArray.forEach(board => {
      requests.push(rp(trello(`boards/${board.id}/lists`)));
    });
    Promise.all(requests)
    .then(requestArray => {
      requestArray.forEach((res2, i) => {
        boardArray[i].lists = {};
        res2 = JSON.parse(res2);
        res2.forEach(bl => {
            if (bl.name.toLowerCase().indexOf('committed') > -1)
              boardArray[i].lists.committed = bl.id;
            if (bl.name.toLowerCase().indexOf('in flight') > -1 ||
              bl.name.toLowerCase().indexOf('🔥') > -1 || // Design board
              bl.name.toLowerCase().indexOf('active') > -1)  // Analysis
              boardArray[i].lists.inflight = bl.id;
            if (bl.name.toLowerCase().indexOf('in review') > -1)
              boardArray[i].lists.review = bl.id;
            if (bl.name.toLowerCase().indexOf('done') > -1)
              boardArray[i].lists.done = bl.id;
        });
      });
      getStandupData(req, res, Standup, Users, boardArray);
    });
  })
};

module.exports.messageLogger = (req, res, Standup, Users) => {
  if (req.body.type === 'url_verification') {
    res.send(req.body.challenge);
  } else {
    Users.findOne({where: {slack: req.body.event.user}})
    .then(user => {
      if (user) {
        if (req.body.event.text == 'restart')
          restartStandup(req, res, Standup, user);
        else
          parseCustomResponse(req, res, Standup, Users, user);
      }
    });
  }
};

module.exports.responseHandler = (req, res, Standup, Users) => {
  var body = JSON.parse(req.body.payload);
  var response = body.original_message;
  switch(body.type == 'dialog_submission' ? body.callback_id : body.actions[0].value) {
    case 'help':
      helpResponse(req, res, body, response);
      break;
    case 'start':
      interruptCheck(req, res, body, response, Standup, Users);
      break;
    case 'nointerrupt':
      noInterruptHandler(req, res, body, response, Standup, Users);
      break;
    case 'interrupts':
      interruptHandler(req, res, body, response, Standup, Users);
      break;
    case 'interruptDialog':
      interruptStorer(req, res, body, response, Standup, Users);
      break;
    case 'priorities':
      priorityHandler(req, res, body, response, Standup, Users);
      break;
    case 'prioritiesDialog':
      priorityStorer(req, res, body, response, Standup, Users);
      break;
    case 'edit':
      priorityEditor(req, res, body, response, Standup, Users);
      break;
    case 'prioritiesEditor':
      priorityEditorStorer(req, res, body, response, Standup, Users);
      break;
    case 'sidebar':
      sidebarHandler(req, res, body, response, Standup, Users);
      break;
    case 'cancelSidebar':
      sidebarCanceller(req, res, body, response, Standup, Users);
      break;
    case 'createSidebar':
      sidebarCreatorHandler(req, res, body, response, Standup, Users);
      break;
    case 'createSidebarResponse':
      sidebarCreatorStorer(req, res, body, response, Standup, Users);
      break;
    default:
      res.send('ERROR');
      break;
  }
}

module.exports.reminderHandler = (req, res, Standup, Users) => {
  Standup.findOne({where:{createdAt:{$between:[moment().startOf('day').toDate(), moment().endOf('day').toDate()]}}})
  .then(standup => {
    var userArray = [];
    var data = JSON.parse(standup.dataValues.data);
    Object.keys(data).forEach(user => {
      if (!data[user].responses || data[user].responses.length == 0) {
        userArray.push(user);
      }
    });
    var findUsers = [];
    var requests = [];
    userArray.forEach(user => {
      findUsers.push(Users.findOne({where: {trello: user}}));
    });
    Promise.all(findUsers)
    .then(userArray => {
      userArray.forEach(user => {
        var options = {
          uri: 'https://slack.com/api/im.open',
          qs: {
            token: process.env.SLACK_TOKEN,
            user: user.slack
          },
          json: true
        }
        requests.push(rp(options));
      });
      Promise.all(requests)
      .then(requestArray => {
        var requests2 = [];
        requestArray.forEach((res2, i) => {
          var options2 = {
            uri: 'https://slack.com/api/chat.postMessage',
            qs: {
                token: process.env.SLACK_TOKEN,
                channel: res2.channel.id,
                username: BOT_NAME,
                as_user: true,
                text: '_Don\'t forget to submit your standup report!_'
              },
              json: true
          };
          requests2.push(rp(options2));
        });
        Promise.all(requests2)
        .then(requestArray2 => {
          res.send('Reminders sent!');
        });
      });
    });
  });
}

var interruptHandler = (req, res, body, response, Standup, Users) => {
  rp({
    uri: 'https://slack.com/api/dialog.open',
    method: 'POST',
    body: {
      trigger_id: body.trigger_id,
      dialog: {
        callback_id: "interruptDialog",
        title: "Interrupts",
        elements: [
          {
            type: 'text',
            label: 'Interrupt cause:',
            name: 'interrupt_cause',
          }
        ]
      }
    },
    headers: {
      Authorization: `Bearer ${process.env.SLACK_TOKEN}`
    },
    json: true
  }).then(rpr => {
    res.send();
    Standup.findOne({where:{createdAt:{$between:[moment().startOf('day').toDate(), moment().endOf('day').toDate()]}}})
    .then(standup => {
      Users.findOne({where: {slack: body.user.id}})
      .then(user => {
        var trelloId = user.trello;
        var newStandup = JSON.parse(standup.dataValues.data);
        newStandup[trelloId].responseData = [body, response];
        Standup.update(
          {data: JSON.stringify(newStandup)},
          {where:{createdAt:{$between:[moment().startOf('day').toDate(), moment().endOf('day').toDate()]}}}
        );
      });
    });
  });
}

var interruptStorer = (req, res, body, response, Standup, Users) => {
  Standup.findOne({where:{createdAt:{$between:[moment().startOf('day').toDate(), moment().endOf('day').toDate()]}}})
  .then(standup => {
    Users.findOne({where: {slack: body.user.id}})
    .then(user => {
      var trelloId = user.trello;
      var newStandup = {};

      newStandup = JSON.parse(standup.dataValues.data);
      var body2 = newStandup[trelloId].responseData[0];
      var res2 = newStandup[trelloId].responseData[1];
      newStandup[trelloId].interrupts = body.submission.interrupt_cause

      Standup.update(
        {data: JSON.stringify(newStandup)},
        {where:{createdAt:{$between:[moment().startOf('day').toDate(), moment().endOf('day').toDate()]}}}
      ).then(() => {
        res2.attachments = [{
          pretext: `*${moment().format('MMMM Do, YYYY')}*`,
          title: 'Part 1/3: Standup Review',
          text: '*Interrupts*: ' + body.submission.interrupt_cause,
          color: 'good',
          mrkdwn_in: ['text', 'pretext', 'fields']
        }];
        // sendResponse(req, res, body2, res2);
        preAskQuestions(req, res, body2, res2, Standup, Users);
      });
    });
  });
}

var noInterruptHandler = (req, res, body, response, Standup, Users) => {
  response.attachments = [{
    pretext: `*${moment().format('MMMM Do, YYYY')}*`,
    title: 'Part 1/3: Standup Review',
    text: 'No interrupts.',
    color: 'good',
    mrkdwn_in: ['text', 'pretext', 'fields']
  }];
   var reply = {
    method: 'POST',
    uri: body.response_url,
    body: response,
    json: true
  }
  rp(reply)
  .then(res2 => {
    res.send();
    Standup.findOne({where:{createdAt:{$between:[moment().startOf('day').toDate(), moment().endOf('day').toDate()]}}})
    .then(standup => {
      Users.findOne({where: {slack: body.user.id}})
      .then(user => {
        var trelloId = user.trello;
        var newStandup = JSON.parse(standup.dataValues.data);
        newStandup[trelloId].responseData = [body, response];
        Standup.update(
          {data: JSON.stringify(newStandup)},
          {where:{createdAt:{$between:[moment().startOf('day').toDate(), moment().endOf('day').toDate()]}}}
        ).then(()=>{
          preAskQuestions(req, res, body, response, Standup, Users);
        });
      });
    });
  });
}

var getStandupData = (req, res, Standup, Users, boardArray) => {
  Users.findAll()
  .then(userList => {
    var requests = [];
    var standupData = {};
    var absentUsers = [];
    rp(process.env.OOO_CALENDAR_FEED)
      .then(calRes => {
        var eventArray = parser.fromString(calRes).VCALENDAR.VEVENT;
        var currentTime = moment().unix();
        eventArray.forEach(event => {
          var startTime = moment(event.DTSTART.value)
          var endTime = moment(event.DTEND.value)
          var calUser = event.SUMMARY.substr(0, event.SUMMARY.indexOf('(') - 1);
          if (startTime.unix() < currentTime && currentTime < endTime.unix()) {
            absentUsers.push(calUser);
          }
        });
        userList.forEach(function (user) {
          if (absentUsers.indexOf(user.name) === -1 ) {
            var options = {
              uri: trello(`members/${user.trello}/cards`),
              qs: {
                filter: 'visible',
                fields: ['name', 'idMembers', 'idBoard', 'idList', 'url'].join()
              },
              json: true,
              resolveWithFullResponse: true
            };
            requests.push(rp(options));
          }
        });
        Promise.all(requests)
          .then(requestArray => {
            requestArray.forEach((res2, i) => {
              uid = res2.request.path.match(/members\/(.*)\/cards/g)[0].substr(8,24);
              var attachments = [];
              res2 = res2.body;
              res2.forEach(task => {
                var bi = boardArray.findIndex(board => board.id === task.idBoard);
                if (
                  bi > -1 &&
                  (
                    boardArray[bi].lists.committed === task.idList ||
                    boardArray[bi].lists.inflight === task.idList
                  ) &&
                  task.idMembers.indexOf(uid) > -1
                ) {
                  attachments.push({
                    text: `${boardArray[bi].emoji} <${task.url}|${task.name}>`,
                    mrkdwn_in: ['text', 'pretext', 'fields'],
                    color: '#3AA3E3',
                    attachment_type: 'default',
                    callback_id: `${boardArray[bi].id}:${task.id}`,
                    actions: [
                      {
                        name: 'reply',
                        text: 'Inactive',
                        type: 'button',
                        value: 'inactive',
                      },
                      {
                        name: 'reply',
                        text: 'Active',
                        type: 'button',
                        value: 'active'
                      },
                      {
                        name: 'reply',
                        text: 'In Review',
                        type: 'button',
                        value: 'review'
                      },
                      {
                        name: 'reply',
                        text: 'Delayed/Blocked',
                        type: 'button',
                        style: 'danger',
                        value: 'delay'
                      },
                      {
                        name: 'reply',
                        text: 'Done',
                        type: 'button',
                        style: 'primary',
                        value: 'done'
                      }
                    ]
                  });
                };
              });
              standupData[uid] = {
                cards: attachments ? attachments: [],
                responses: []
              };
            });
            Standup.sync() // using 'force' it drops the table users if it already exists, and creates a new one
            .then(function(){
              var date = req.query.date ? moment(req.query.date) : moment();
              Standup.findOne({where:{createdAt:{$between:[moment().startOf('day').toDate(), date.endOf('day').toDate()]}}})
                .then(standup => {
                  var standupExists = standup && standup.dataValues && standup.dataValues.data;
                  if (!standupExists) {
                    // create standup
                    Standup.create({data: JSON.stringify(standupData)})
                      .then(()=> {
                        Standup.findOne({where:{createdAt:{$between:[moment().startOf('day').toDate(), moment().endOf('day').toDate()]}}})
                          .then(standup => {
                            sendFirstMessage(req, res, standupData, Users);
                          });
                      });
                  } else {
                    // update standup
                    Standup.update(
                      {data: JSON.stringify(standupData)},
                      {where:{createdAt:{$between:[moment().startOf('day').toDate(), moment().endOf('day').toDate()]}}}
                    )
                      .then(() => {
                        Standup.findOne({where:{createdAt:{$between:[moment().startOf('day').toDate(), moment().endOf('day').toDate()]}}})
                          .then(standup => {
                            sendFirstMessage(req, res, standupData, Users);
                          })
                      });
                  }
              })
            });
          });
      });
  });
}

var sendFirstMessage = (req, res, standupData, Users) => {
  var requests = [];
  var findUsers = [];
  Object.keys(standupData).forEach(user => {
    findUsers.push(Users.findOne({where: {trello: user}}));
  });
  Promise.all(findUsers)
  .then(userArray => {
    userArray.forEach(user => {
      var options = {
        uri: 'https://slack.com/api/im.open',
        qs: {
          token: process.env.SLACK_TOKEN,
          user: user.slack
        },
        json: true
      }
      requests.push(rp(options));
    });
    Promise.all(requests)
    .then(requestArray => {
      var requests2 = [];
      requestArray.forEach((res2, i) => {
        var options2 = {
          uri: 'https://slack.com/api/chat.postMessage',
          qs: {
              token: process.env.SLACK_TOKEN,
              channel: res2.channel.id,
              username: BOT_NAME,
              as_user: true,
              attachments: JSON.stringify([{
                pretext: `*${moment().format('MMMM Do, YYYY')}*`,
                title: `Hey, it's time for standup! Let me know when you're ready to begin.`,
                mrkdwn_in: ['text', 'pretext', 'fields'],
                color: '#3AA3E3',
                attachment_type: 'default',
                callback_id: 'options',
                actions: [
                  {
                    name: 'start',
                    text: '🌄 Let\'s Go!',
                    type: 'button',
                    style: 'primary',
                    value: 'start',
                  },
                  {
                    name: 'start',
                    text: '❓ What\'s this?',
                    type: 'button',
                    value: 'help'
                  }
                ]
              }]),
            },
            json: true
        };
        requests2.push(rp(options2));
      });
      Promise.all(requests2)
        .then(requestArray2 => {
          res.send('Standup Initiated!');
        });
    });
  });
};

// Response helper
var sendResponse = (req, res, body, response) => {
    var reply = {
      method: 'POST',
      uri: body.response_url,
      body: response,
      json: true
    }
    rp(reply)
      .then(res2 => {
        res.send();
      });
}

// 'What's This?' response
var helpResponse = (req, res, body, response) => {
  response.attachments[0].title = `This is a bot which collects your standup report.  The bot checks Trello boards for cards assigned to you, which are in the Committed or In Flight colums, and requests a status update for those tasks. At the end of the standup report, you can type a message to the bot to add extra notes for that days' standup.`;
  response.attachments[0].actions = [{
    name: 'continue',
    text: 'Got it!',
    type: 'button',
    style: 'primary',
    value: 'start'
  }];
  sendResponse(req, res, body, response);
}

var interruptCheck = (req, res, body, response, Standup, Users) => {
  var date = req.query.date ? moment(req.query.date) : moment();
  Standup.findOne({
      where: {
          createdAt: {
              $lt: date.startOf('day').toDate()
          }
      },
      order: [[ 'createdAt', 'DESC']]
  }).then(prevStandup => {
    var msg = JSON.parse(req.body.payload);
    Users.findOne({where: {slack: msg.user.id}}).then(user => {
      var trelloId = user.trello;
      var prevStandupData = JSON.parse(prevStandup.data);
      var error = false;
      if (moment(prevStandup.createdAt).diff(moment()) < -432000000) {
      // if the last standup is over 5 days ago, skip
        error = "Last standup was over 5 days ago, skipping.";
      } else if (!prevStandupData[trelloId]) {
      // if the user did not participate in the last standup, skip
        error = "You didn't participate in the last standup, skipping";
      } else {
        // if the user did not have any active tasks in the last, skip
        var activeTasks = prevStandupData[trelloId].responses.filter(task => {return task.response == 'active'});
        if (activeTasks.length == 0) {
          error = "You didn't have any active tasks in the last standup, skipping."
        }
      }
      var attachments = [
        {
          pretext: `*${moment().format('MMMM Do, YYYY')}*`,
          title: 'Part 1/3: Standup Review',
          text: error ? `_${error}_` : `Here's your priorities from the last standup.  Were you able to get to some of them or did you have interrupts?\n${activeTasks.length > 0 ? activeTasks.map(t=>t.text).join("\n") : null}`,
          mrkdwn_in: ['text', 'pretext', 'fields'],
          attachment_type: 'default',
          callback_id: 'options',
          color: error ? null : 'good',
          actions: error ? null : [
            {
              name: 'nointerrupt',
              text: '✅ All quiet on the western front',
              type: 'button',
              style: 'primary',
              value: 'nointerrupt',
            },
            {
              name: 'interrupts',
              text: '🛑 Interrupts Ahoy!...',
              type: 'button',
              style: 'danger',
              value: 'interrupts'
            }
          ]
        }
      ]
      sendResponse(req, res, body, {
        attachments: attachments
      });
      if(error) {
        Standup.findOne({where:{createdAt:{$between:[moment().startOf('day').toDate(), moment().endOf('day').toDate()]}}})
        .then(standup => {
          var newStandup = JSON.parse(standup.dataValues.data);
          response.attachments = attachments;
          newStandup[trelloId].responseData = [body, response];
          newStandup[trelloId].interruptError = error;
          Standup.update(
            {data: JSON.stringify(newStandup)},
            {where:{createdAt:{$between:[moment().startOf('day').toDate(), moment().endOf('day').toDate()]}}}
          ).then(()=>{
           preAskQuestions(req, res, body, response, Standup, Users);
          });
        });
      }
    });
  });
};

var preAskQuestions = (req, res, body, response, Standup, Users) => {
  response.attachments.push({
    title: 'Part 2/3: Today\'s Priorities',
    text: 'Please select the option which best reflects the status of each task:',
    attachment_type: 'default',
    callback_id: 'options',
    actions: [
      {
        name: 'priorities',
        text: '✏️ Edit priorities',
        type: 'button',
        value: 'priorities',
      },
    ]
  });
  sendResponse(req, res, body, response);
  priorityHandler(req, res, body, response, Standup, Users);
};

var priorityStorer = (req, res, body, response, Standup, Users) => {
  Standup.findOne({where:{createdAt:{$between:[moment().startOf('day').toDate(), moment().endOf('day').toDate()]}}})
  .then(standup => {
    Users.findOne({where: {slack: body.user.id}})
    .then(user => {
      var trelloId = user.trello;
      var newStandup = JSON.parse(standup.dataValues.data);
      Object.keys(body.submission).forEach(field => {
        if (body.submission[field]) {
          if (field == 'notes') {
            if (body.submission[field]) {
              newStandup[trelloId].notes = newStandup[trelloId].notes || [];
              newStandup[trelloId].notes.push({
                ts: body.action_ts,
                text: body.submission[field]
              });
            }
          } else {
            if (body.submission[field] == 'other') {
              newStandup[trelloId].cards = [{
                "text": "❓Other (see note)",
                "response": 'active',
              }].concat(newStandup[trelloId].cards);
            } else {
              var cardidx = newStandup[trelloId].cards.findIndex(c => {
                var search = body.submission[field].substr(3);
                // if the text was truncated, remove the ellipsis from search string
                search = search.substr(search.length - 3) === '...' ? search.substr(0,search.length - 3) : search;
                return c.text.indexOf(search) > -1
              });
              if (cardidx > -1) {
                newStandup[trelloId].cards[cardidx].response = 'active';
              }
            }
          }
        }
      });
      newStandup[trelloId].cards.forEach(card => {
        card.response == card.response || 'inactive';
      })
      newStandup[trelloId].responses = newStandup[trelloId].cards.slice();
      newStandup[trelloId].cards = [];

      var interruptText = "No interrupts."
      if (newStandup[trelloId].interruptError) {
        interruptText = `_${newStandup[trelloId].interruptError}_`;
      } else if (newStandup[trelloId].interrupts) {
        interruptText = `*Interrupts:* ${newStandup[trelloId].interrupts}`;
      }

      Standup.update(
        {data: JSON.stringify(newStandup)},
        {where:{createdAt:{$between:[moment().startOf('day').toDate(), moment().endOf('day').toDate()]}}}
      ).then(() => {
        var body2 = newStandup[trelloId].responseData[0];
        var res2 = newStandup[trelloId].responseData[1];
        res2.attachments = [{
          pretext: `*${moment().format('MMMM Do, YYYY')}*`,
          title: 'Part 1/3: Standup Review',
          text: interruptText,
          color: newStandup[trelloId].interruptError ? null : 'good',
          mrkdwn_in: ['text', 'pretext', 'fields']
        },{
          title: 'Part 2/3: Today\'s Priorities',
          text: `${newStandup[trelloId].responses.filter(c=>{
            return c.response == 'active'
          }).map(c=>{
            return c.text;
          }).join('\n')}
${newStandup[trelloId].notes ?
  '_' + newStandup[trelloId].notes.map(n=>n.text).join('\n') + '_' :
  ''
}
          `,
          color: 'good',
          mrkdwn_in: ['text', 'pretext', 'fields']
        },{
          title: 'Part 3/3: All done!',
          text: 'Leave an additional note if you\'d like, or select one of the options below:',
          mrkdwn_in: ['text', 'pretext', 'fields'],
          attachment_type: 'default',
          callback_id: 'options',
          color: 'good',
          actions: [
            {
              name: 'edit',
              text: '✏️ Adjust priorities',
              type: 'button',
              value: 'edit',
            },
            {
              name: 'sidebar',
              text: '🙋‍ View/Request sidebars',
              type: 'button',
              value: 'sidebar'
            },
          ]
        }];
        sendResponse(req, res, body2, res2);
      });
    });
  });
};

var priorityHandler = (req, res, body, response, Standup, Users) => {
  var msg = JSON.parse(req.body.payload);
  var date = req.query.date ? moment(req.query.date) : moment();
  Users.findOne({where: {slack: msg.user.id}})
  .then(user => {
    Standup.findOne({where:{createdAt:{$lt: date.startOf('day').toDate()}},order:[['createdAt', 'DESC']]})
    .then(prevStandup => {
      Standup.findOne({where:{createdAt:{$between:[moment().startOf('day').toDate(), moment().endOf('day').toDate()]}}})
      .then(standup => {

        var trelloId = user.trello;
        var prevStandupData = JSON.parse(prevStandup.data);

        var standupData = JSON.parse(standup.data);
        var priorityList = standupData[trelloId].cards
          .map(task => {
            var pi = task.text.indexOf('|');
            var text = task.text.substr(0,2) + ' ' + task.text.substr(pi+1, task.text.length-pi-2);
            if (text.length > 71) {
              text = text.substr(0,71) + '...';
            }
            return {
              text: text,
              value: text,
              label: text,
            }
          });

        priorityList = [{
          text: '❓Other (include note below)',
          value:  'other',
          label:  '❓Other (include note below)'
        }].concat(priorityList);

        var prevPriorities = prevStandupData[trelloId] ? prevStandupData[trelloId].responses
        .filter(task => {return task.response == 'active'})
        .map(task => {
          var pi = task.text.indexOf('|');
          var text = task.text.substr(0,2) + ' ' + task.text.substr(pi+1, task.text.length-pi-2);
          if (text.length > 71) {
            text = text.substr(0,71) + '...';
          }
          return text;
        })
        .filter(task => {return priorityList.find(t => {return t.text == task})}) : [];

        rp({
          uri: 'https://slack.com/api/dialog.open',
          method: 'POST',
          body: {
            trigger_id: body.trigger_id,
            dialog: {
              callback_id: "prioritiesDialog",
              title: "Priorities",
              elements: [
                {
                  type: 'select',
                  label: '1st Priority',
                  name: 'priority_1',
                  value: prevPriorities[0],
                  options: priorityList
                },
                {
                  type: 'select',
                  label: '2nd Priority',
                  name: 'priority_2',
                  value: prevPriorities[1],
                  options: priorityList,
                  optional: true,
                },
                {
                  type: 'select',
                  label: '3rd Priority',
                  name: 'priority_3',
                  value: prevPriorities[2],
                  options: priorityList,
                  optional: true,
                },
                {
                  type: 'textarea',
                  label: 'Additional notes',
                  name: 'notes',
                  optional: true,
                }
              ]
            }
          },
          headers: {
            Authorization: `Bearer ${process.env.SLACK_TOKEN}`
          },
          json: true
        }).then(rpr => {
          res.send();
        });
      });
    });
  });
};

var priorityEditor = (req, res, body, response, Standup, Users) => {
  var msg = JSON.parse(req.body.payload);
  var date = req.query.date ? moment(req.query.date) : moment();
  Users.findOne({where: {slack: msg.user.id}})
  .then(user => {
    Standup.findOne({where:{createdAt:{$between:[moment().startOf('day').toDate(), moment().endOf('day').toDate()]}}})
    .then(standup => {

      var trelloId = user.trello;

      var standupData = JSON.parse(standup.data);
      var priorityList = standupData[trelloId].responses
        .map(task => {
          var text = task.text;
          if (task.text != '❓Other (see note)') {
            var pi = task.text.indexOf('|');
            var text = task.text.substr(0,2) + ' ' + task.text.substr(pi+1, task.text.length-pi-2);
            if (text.length > 71) {
              text = text.substr(0,71) + '...';
            }
          }

          return {
            text: text,
            value: text,
            label: text,
          }
        });

      priorityList = [{
        text: '❓Other (include note below)',
        value:  'other',
        label:  '❓Other (include note below)'
      }].concat(priorityList);

      var activePriorities = standupData[trelloId].responses
      .filter(task => {return task.response == 'active'})
      .map(task => {
        var text = task.text;
        if (task.text != '❓Other (see note)') {
          var pi = task.text.indexOf('|');
          text = task.text.substr(0,2) + ' ' + task.text.substr(pi+1, task.text.length-pi-2);
        }
        if (text.length > 71) {
          text = text.substr(0,71) + '...';
        }
        return text;
      })
      .filter(task => {return priorityList.find(t => {return t.text == task})});

      rp({
          uri: 'https://slack.com/api/dialog.open',
          method: 'POST',
          body: {
            trigger_id: body.trigger_id,
            dialog: {
              callback_id: "prioritiesEditor",
              title: "Priorities",
              elements: [
                {
                  type: 'select',
                  label: '1st Priority',
                  name: 'priority_1',
                  value: activePriorities[0],
                  options: priorityList
                },
                {
                  type: 'select',
                  label: '2nd Priority',
                  name: 'priority_2',
                  value: activePriorities[1],
                  options: priorityList,
                  optional: true,
                },
                {
                  type: 'select',
                  label: '3rd Priority',
                  name: 'priority_3',
                  value: activePriorities[2],
                  options: priorityList,
                  optional: true,
                },
                {
                  type: 'textarea',
                  label: 'Additional notes',
                  name: 'notes',
                  value: standupData[trelloId].notes ? standupData[trelloId].notes.map(n=>{return n.text}).join('\n') : null,
                  optional: true,
                }
              ]
            }
          },
          headers: {
            Authorization: `Bearer ${process.env.SLACK_TOKEN}`
          },
          json: true
        }).then(rpr => {
          res.send();
        });

    });
  });
};

var priorityEditorStorer = (req, res, body, response, Standup, Users) => {
  Standup.findOne({where:{createdAt:{$between:[moment().startOf('day').toDate(), moment().endOf('day').toDate()]}}})
  .then(standup => {
    Users.findOne({where: {slack: body.user.id}})
    .then(user => {
      var trelloId = user.trello;
      var newStandup = JSON.parse(standup.dataValues.data);
      newStandup[trelloId].responses.forEach(card => {
        delete card.response;
      })
      Object.keys(body.submission).forEach(field => {
        if (body.submission[field]) {
          if (field == 'notes') {
            if (body.submission[field]) {
              newStandup[trelloId].notes = body.submission[field].split('\n').map(n=>{
                return {
                  ts: body.action_ts,
                  text: n
                }
              });
            }
          } else {
            if (body.submission[field] == 'other') {
              newStandup[trelloId].cards[0] = {
                "text": "❓Other (see note)",
                "response": 'active',
              };
            } else {
              var cardidx = newStandup[trelloId].cards.findIndex(c => {
              return c.text.indexOf(body.submission[field].substr(3)) > -1
              });
              if (cardidx > -1) {
                newStandup[trelloId].cards[cardidx].response = 'active';
              }
            }
          }
        }
      });
      newStandup[trelloId].responses.forEach(card => {
        card.response = card.response || 'inactive';
      })

      var interruptText = "No interrupts."
      if (newStandup[trelloId].interruptError) {
        interruptText = `_${newStandup[trelloId].interruptError}_`;
      } else if (newStandup[trelloId].interrupts) {
        interruptText = `*Interrupts:* ${newStandup[trelloId].interrupts}`;
      }

      Standup.update(
        {data: JSON.stringify(newStandup)},
        {where:{createdAt:{$between:[moment().startOf('day').toDate(), moment().endOf('day').toDate()]}}}
      ).then(() => {
        var body2 = newStandup[trelloId].responseData[0];
        var res2 = newStandup[trelloId].responseData[1];
        res2.attachments = [{
          pretext: `*${moment().format('MMMM Do, YYYY')}*`,
          title: 'Part 1/3: Standup Review',
          text: interruptText,
          color: newStandup[trelloId].interruptError ? null : 'good',
          mrkdwn_in: ['text', 'pretext', 'fields']
        },{
          title: 'Part 2/3: Today\'s Priorities',
          text: `${newStandup[trelloId].responses.filter(c=>{
            return c.response == 'active'
          }).map(c=>{
            return c.text;
          }).join('\n')}
${newStandup[trelloId].notes ?
  '_' + newStandup[trelloId].notes.map(n=>n.text).join('\n') + '_' :
  ''
}
          `,
          color: 'good',
          mrkdwn_in: ['text', 'pretext', 'fields']
        },{
          title: 'Part 3/3: All done!',
          text: 'Leave an additional note if you\'d like, or select one of the options below:',
          mrkdwn_in: ['text', 'pretext', 'fields'],
          attachment_type: 'default',
          callback_id: 'options',
          color: 'good',
          actions: [
            {
              name: 'edit',
              text: '✏️ Adjust priorities',
              type: 'button',
              value: 'edit',
            },
            {
              name: 'sidebar',
              text: '🙋‍ Request sidebar',
              type: 'button',
              value: 'sidebar'
            },
          ]
        }];
        sendResponse(req, res, body2, res2);
      });
    });
  });
};

var sidebarHandler = (req, res, body, response, Standup, Users) => {
  Standup.findOne({where:{createdAt:{$between:[moment().startOf('day').toDate(), moment().endOf('day').toDate()]}}})
    .then((standup) => {
    var newStandup = JSON.parse(standup.dataValues.data);
    var msg = JSON.parse(req.body.payload);
    Users.findOne({where: {slack: msg.user.id}})
    .then(user => {
      var trelloId = user.trello;
      var sidebars = newStandup[trelloId].sidebars || [];
      var actions = sidebars.filter(s=>{s.user==user.trello}).map(s=>{
        return {
          name: s.name,
          text: `🚫 Cancel ${s.name}`,
          type: 'button',
          value: 'cancelSidebar'
        }
      });
      actions.push({
        name: 'createSidebar',
        text: '✨ Create new sidebar',
        type: 'button',
        value: 'createSidebar'
      });
      var options = {
        uri: 'https://slack.com/api/chat.postMessage',
        qs: {
            token: process.env.SLACK_TOKEN,
            channel: body.channel.id,
            username: BOT_NAME,
            as_user: true,
            attachments: JSON.stringify([{
              title: 'Current sidebars:',
              text: (sidebars.length > 0) ? sidebars.map(s=>{'- '+s.name}).join('\n') : `_No sidebars so far today._`,
              mrkdwn_in: ['text', 'pretext', 'fields'],
              attachment_type: 'default',
              callback_id: 'options',
              actions: actions
            }]),
          },
          json: true
        }
        rp(options).then(res.send());
    });
  });
}

var sidebarCanceller = (req, res, body, response, Standup, Users) => {
  Standup.findOne({where:{createdAt:{$between:[moment().startOf('day').toDate(), moment().endOf('day').toDate()]}}})
  .then(standup => {
    Users.findOne({where: {slack: body.user.id}})
    .then(user => {
      var trelloId = user.trello;
      var newStandup = JSON.parse(standup.dataValues.data);

      newStandup[trelloId].sidebars = newStandup[trelloId].sidebars || [];
      var i = newStandup[trelloId].sidebars.findIndex(s=>{return s.user == user.trello && s.name == body.actions[0].name});
      if (i > -1)
        newStandup[trelloId].sidebars.splice(i,1);

      Standup.update(
        {data: JSON.stringify(newStandup)},
        {where:{createdAt:{$between:[moment().startOf('day').toDate(), moment().endOf('day').toDate()]}}}
      ).then(() => {
        var sidebars = newStandup[trelloId].sidebars || [];
        var actions = sidebars.filter(s=>{return s.user=user.trello}).map(s=>{
          return {
            name: s.name,
            text: `🚫 Cancel ${s.name}`,
            type: 'button',
            value: 'cancelSidebar'
          }
        });
        actions.push({
          name: 'createSidebar',
          text: '✨ Create new sidebar',
          type: 'button',
          value: 'createSidebar'
        });
        res.attachments = [{
          title: 'Current sidebars:',
          text: sidebars.length > 0 ? sidebars.map(s=>{return '- '+s.name}).join('\n') : `_No sidebars so far today._`,
          mrkdwn_in: ['text', 'pretext', 'fields'],
          attachment_type: 'default',
          callback_id: 'options',
          actions: actions
        }];
        sendResponse(req, res, body, res);
      });
    });
  });
}

var sidebarCreatorHandler = (req, res, body, response, Standup, Users) => {
  rp({
    uri: 'https://slack.com/api/dialog.open',
    method: 'POST',
    body: {
      trigger_id: body.trigger_id,
      dialog: {
        callback_id: "createSidebarResponse",
        title: "Create Sidebar",
        elements: [
          {
            type: 'text',
            label: 'Sidebar Name',
            name: 'sidebar',
          }
        ]
      }
    },
    headers: {
      Authorization: `Bearer ${process.env.SLACK_TOKEN}`
    },
    json: true
  }).then(rpr => {
    res.send();
    Standup.findOne({where:{createdAt:{$between:[moment().startOf('day').toDate(), moment().endOf('day').toDate()]}}})
    .then(standup => {
      Users.findOne({where: {slack: body.user.id}})
      .then(user => {
        var trelloId = user.trello;
        var newStandup = JSON.parse(standup.dataValues.data);
        newStandup[trelloId].sidebarData = [body, response];
        Standup.update(
          {data: JSON.stringify(newStandup)},
          {where:{createdAt:{$between:[moment().startOf('day').toDate(), moment().endOf('day').toDate()]}}}
        );
      });
    });
  });
}

var sidebarCreatorStorer = (req, res, body, response, Standup, Users) => {
  Standup.findOne({where:{createdAt:{$between:[moment().startOf('day').toDate(), moment().endOf('day').toDate()]}}})
  .then(standup => {
    Users.findOne({where: {slack: body.user.id}})
    .then(user => {
      var trelloId = user.trello;
      var newStandup = JSON.parse(standup.dataValues.data);

      newStandup[trelloId].sidebars = newStandup[trelloId].sidebars || [];

      newStandup[trelloId].sidebars.push({
        name: body.submission.sidebar,
        user: user.trello
      })

      Standup.update(
        {data: JSON.stringify(newStandup)},
        {where:{createdAt:{$between:[moment().startOf('day').toDate(), moment().endOf('day').toDate()]}}}
      ).then(() => {
        var body2 = newStandup[trelloId].sidebarData[0];
        var res2 = newStandup[trelloId].sidebarData[1];


        var actions = newStandup[trelloId].sidebars.filter(s=>{return s.user==user.trello}).map(s=>{
          return {
            name: s.name,
            text: `🚫 Cancel ${s.name}`,
            type: 'button',
            value: 'cancelSidebar'
          }
        });
        actions.push({
          name: 'createSidebar',
          text: '✨ Create new sidebar',
          type: 'button',
          value: 'createSidebar'
        });
        res2.attachments = [{
          title: 'Current sidebars:',
          text: (newStandup[trelloId].sidebars.length > 0) ? newStandup[trelloId].sidebars.map(s=>{return '- '+s.name}).join('\n') : `_No sidebars so far today._`,
          mrkdwn_in: ['text', 'pretext', 'fields'],
          attachment_type: 'default',
          callback_id: 'options',
          actions: actions
        }];
        sendResponse(req, res, body2, res2);
      });
    });
  });
}

var restartStandup = (req, res, Standup, user) => {
  Standup.findOne({where:{createdAt:{$between:[moment().startOf('day').toDate(), moment().endOf('day').toDate()]}}})
    .then(standup => {
      if (standup && standup.dataValues && standup.dataValues.data) {
        var newStandup = JSON.parse(standup.dataValues.data);
        var trelloId = user.trello;
        newStandup[trelloId].cards = newStandup[trelloId].cards.concat(newStandup[trelloId].responses);
          newStandup[trelloId].responses = [];
          Standup.update(
              {data: JSON.stringify(newStandup)},
              {where:{createdAt:{$between:[moment().startOf('day').toDate(), moment().endOf('day').toDate()]}}}
            )
              .then(() => {
                var opt = {
                  uri: 'https://slack.com/api/chat.postMessage',
                  qs: {
                      token: process.env.SLACK_TOKEN,
                      channel: req.body.event.channel,
                      username: BOT_NAME,
                      as_user: true,
                      attachments: JSON.stringify([{
                        pretext: `*${moment().format('MMMM Do, YYYY')}*`,
                        title: `Hey, it's time for standup! Let me know when you're ready to begin.`,
                        mrkdwn_in: ['text', 'pretext', 'fields'],
                        color: '#3AA3E3',
                        attachment_type: 'default',
                        callback_id: 'options',
                        actions: [
                          {
                            name: 'start',
                            text: '🌄 Let\'s Go!',
                            type: 'button',
                            style: 'primary',
                            value: 'start',
                          },
                          {
                            name: 'start',
                            text: '❓ What\'s this?',
                            type: 'button',
                            value: 'help'
                          }
                        ]
                      }]),
                    },
                    json: true
                };
                rp(opt).then(() => {
                  res.sendStatus(200);
                });
              });
      } else {
        var opt = {
          uri: 'https://slack.com/api/chat.postMessage',
          qs: {
              token: process.env.SLACK_TOKEN,
              channel: req.body.event.channel,
              username: BOT_NAME,
              as_user: true,
              attachments: JSON.stringify([{
                title: `⚠️ You can't restart a standup before it's begun, silly!`,
                color: 'warn',
                attachment_type: 'default',
              }]),
            },
            json: true
        };
        rp(opt).then(() => {
          res.sendStatus(200);
        });
      }
    });
}

var parseCustomResponse = (req, res, Standup, Users, user) => {
  Standup.findOne({where:{createdAt:{$between:[moment().startOf('day').toDate(), moment().endOf('day').toDate()]}}})
    .then(standup => {
      var trelloId = user.trello;
      var newStandup = {};
      var standupExists = standup && standup.dataValues && standup.dataValues.data;

      var standupResponse = () => {
        var msg = {
          uri: 'https://slack.com/api/chat.postMessage',
          qs: {
              token: process.env.SLACK_TOKEN,
              channel: req.body.event.channel,
              username: BOT_NAME,
              as_user: true,
              attachments: JSON.stringify([{color: 'good', title: `I've attached this note to today's standup. Thanks! 👍 `}])
            },
            json: true
        };
        rp(msg);
        res.sendStatus(200);
      };

      if (standupExists) {
        newStandup = JSON.parse(standup.dataValues.data);
        newStandup[trelloId].notes = newStandup[trelloId].notes || [];
      } else {
        newStandup[trelloId] = {cards: [], responses: [], notes: []};
      }

      newStandup[trelloId].notes.push({
        ts: req.body.event.event_ts,
        text: req.body.event.text
      });
      if (standupExists) {
        Standup.update(
          {data: JSON.stringify(newStandup)},
          {where:{createdAt:{$between:[moment().startOf('day').toDate(), moment().endOf('day').toDate()]}}}
        ).then(standupResponse);
      } else {
        Standup.create({
          data: JSON.stringify(newStandup)
        }).then(standupResponse);
      }
    });
}
