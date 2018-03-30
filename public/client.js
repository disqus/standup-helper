$(function() {
  // Get list of users
  $.get('/u', function(userList) {

    var findUserByTrelloId = (trelloid) => {
      var user = userList.find((user) => {return user.trello == trelloid});
      return user ? user : false;
    }

    var boards = [];
    var date = window.location.hash.substr(1);
    if (!date) {
      var now = new Date();
      date = `${now.getFullYear()}-${('0' + (now.getMonth() + 1)).slice(-2)}-${now.getDate()}`
    }
    document.getElementById('date').value = date;
    document.getElementById('date').addEventListener('change', evt => {
      window.location.hash = evt.target.value;
      document.getElementById('container').innerHTML = '';
      document.getElementById('boardFilters').innerHTML = '';
      getStandupData(`?date=${evt.target.value}`);
    })
    // get standup data
    var getStandupData = function(date) {
      $.get('/v' + date, function(standup) {
        if (standup[0] === 'No standup data found.') {
          $('#container').append('No standup data found.');
        } else {
          var data = JSON.parse(standup[0].data);
          Object.keys(data).forEach((user) => {
              var d = document.createElement('div');
              d.id = user;
              d.innerHTML = '<span class="name">' + findUserByTrelloId(user).name + '</span>';
              if (
                data[user].responses && data[user].responses.length == 0 &&
                (
                  !data[user].notes ||
                  data[user].notes && data[user].notes.length == 0
                ) &&
                !data[user].interrupts
                !data[user].sidebars
              )
                d.classList.add('empty');

              if (data[user].interrupts) {
                var f = document.createElement('div');
                f.classList.add('interrupt');
                f.innerHTML = data[user].interrupts;
                $(d).append(f);
              }

              data[user].responses.forEach((task) => {
                var e = document.createElement('div');
                if (task.text != '❓Other (see note)') {
                  var emoji = task.text.substr(0,2).trim();
                  d.classList.add(emoji);
                  if (boards.indexOf(emoji) === -1)
                    boards.push(emoji);
                  var url = task.text.match(/<(.*?)\|/g)[0];
                  url = url.substr(1, url.length-2);
                  var title = task.text.match(/\|(.*?)>/g)[0];
                  title = title.substr(1, title.length-2);
                  var status = task.response;
                  var statusHtml;
                  switch (status) {
                    case 'inactive':
                      statusHtml = '';
                      e.classList.add('inactive');
                      break;
                    case 'active':
                      statusHtml = '';
                      e.classList.add('active');
                      break;
                    case 'review':
                      statusHtml = ' <b class="green">In Review</b>';
                      e.classList.add('inactive');
                      break;
                    case 'done':
                      statusHtml = ' <b class="green">Done</b>';
                      e.classList.add('inactive');
                      break;
                    case 'blocker-creep':
                      statusHtml = ' <b class="red">Delayed - Scope Creep</b>';
                      e.classList.add('inactive');
                      break;
                    case 'blocker-complex':
                      statusHtml = ' <b class="red">Delayed - Complexity</b>';
                      e.classList.add('inactive');
                      break;
                    case 'blocker-interrupt':
                      statusHtml = ' <b class="red">Blocked - Interrupts</b>';
                      e.classList.add('inactive');
                      break;
                    case 'blocker-dependency':
                      statusHtml = ' <b class="red">Blocked - Dependencies</b>';
                      e.classList.add('inactive');
                      break;
                    default:
                      e.classList.add('inactive');
                      break;
                  }
                  e.classList.add(emoji);
                  e.innerHTML =
                    (status && status != 'inactive' ? '<b>' : '') +
                    '<a href="' + url + '" target="_blank">' +
                    emoji +
                    ' ' +
                    title +
                    '</a> ' +
                    (status && status != 'inactive' ? '</b>' : '');
                } else {
                  e.classList.add('other');
                  e.innerHTML = task.text;
                }
                $(d).append(e);
              });
              if (data[user].notes && data[user].notes.length >= 1 ) {
                data[user].notes.forEach((note) => {
                  var f = document.createElement('div');
                  f.classList.add('note');
                  f.innerHTML = note.text;
                  $(d).append(f);
                });
              }
              if (data[user].sidebars) {
                data[user].sidebars.forEach(sidebar => {
                  var g = document.createElement('div');
                  g.classList.add('sidebar');
                  g.innerHTML = sidebar.name;
                  $(d).append(g)
                })
              }
              $('#container').append(d);
          });
          var t = document.createElement('input');
          var tl = document.createElement('label');
          t.type = "checkbox";
          t.classList.add('task-filter');
          t.id="inactive";
          t.value="inactive"
          t.checked = localStorage.getItem('filter-inactive') == 'false' ? false : true;
          tl.htmlFor="inactive";
          tl.innerText="Inactive Tasks";
          $('#boardFilters').append(t);
          $('#boardFilters').append(tl)
          var t2 = document.createElement('input');
          var tl2 = document.createElement('label');
          t2.type = "checkbox";
          t2.classList.add('task-filter');
          t2.id="noreports";
          t2.value="empty";
          t2.checked = localStorage.getItem('filter-empty') == 'false' ? false : true;
          tl2.htmlFor="noreports";
          tl2.innerText="No-Reports";
          $('#boardFilters').append(t2);
          $('#boardFilters').append(tl2);
          boards.forEach(board => {
            var b = document.createElement('input');
            var bl = document.createElement('label');
            b.type="checkbox";
            b.name="filter";
            b.id=board;
            b.value=board;
            b.checked=localStorage.getItem(`filter-${board}`) == 'false' ? false : true;;
            b.classList.add('board-filter');
            bl.htmlFor=board;
            bl.innerText=board;
            $('#boardFilters').append(b);
            $('#boardFilters').append(bl);
          });
          $('.task-filter').on('click', evt => {
            if (evt.target.checked)
              $('.'+evt.target.value).show();
            else
              $('.'+evt.target.value).hide();
            localStorage.setItem(`filter-${evt.target.value}`, evt.target.checked);
          })
          $('.board-filter').on('click', evt => {
            if (evt.target.checked)
              $('#container div div.'+evt.target.value).show();
            else
              $('#container div div.'+evt.target.value).hide();
            localStorage.setItem(`filter-${evt.target.value}`, evt.target.checked);
          });
          Object.keys(localStorage).forEach(key => {
            if (key.substr(0,7) == 'filter-' && localStorage[key] == "false") {
              var filter = key.substr(7);
              if (filter == 'empty' || filter == 'inactive') {
                $('.'+filter).hide();
              } else {
                $('#container div div.'+filter).hide();
              }
            }
          });
        }
      });
    };
    getStandupData(window.location.hash.substr(1) ? '?date=' + window.location.hash.substr(1) : '');
    $.get('/d', function(diffArray) {
      diffArray[0].forEach(diff => {
        var d = document.createElement('div');
        var a = document.createElement('a');
        a.href = diff.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.innerHTML = `D${diff.id}: ${diff.title}`;
        var i = document.createElement('img');
        $.get('https://api.trello.com/1/members/' + diff.author, data => {
          if (data.avatarHash) {
            var img = document.createElement('img');
            img.src = `https://trello-avatars.s3.amazonaws.com/${data.avatarHash}/30.png`;
            d.appendChild(img);
          } else {
            var noimg = document.createElement('div');
            noimg.className = 'noimg';
            noimg.innerHTML = data.initials;
            d.appendChild(noimg);
          }
          d.appendChild(a);
          document.getElementById('diffs').appendChild(d);
        });
      });
      diffArray[1].forEach(diff => {
        var d = document.createElement('div');
        var a = document.createElement('a');
        a.href = diff.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.innerHTML = `D${diff.id}: ${diff.title}`;
        var i = document.createElement('img');
        $.get('https://api.trello.com/1/members/' + diff.author, data => {
          if (data.avatarHash) {
            var img = document.createElement('img');
            img.src = `https://trello-avatars.s3.amazonaws.com/${data.avatarHash}/30.png`;
            d.appendChild(img);
          } else {
            var noimg = document.createElement('div');
            noimg.className = 'noimg';
            noimg.innerHTML = data.initials;
            d.appendChild(noimg);
          }
          d.appendChild(a);
          document.getElementById('review-diffs').appendChild(d);
        });
      });
    });
    $.get('/t', function(timeoffs) {
      timeoffs.forEach(entry => {
        var e = document.createElement('div');
        e.innerHTML = `${entry.name}: ${entry.start} - ${entry.end}`;
        document.getElementById('timeoff').appendChild(e);
      });
    });
  });
});
