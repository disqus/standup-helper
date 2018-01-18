# Sets up remote port forwarding for your Slack app.
# ssh -R [REMOTE PORT]:localhost:[LOCAL APP PORT] [USER]@[REMOTE SERVER]
#
# Then, on your remote server (apache) create a new site definition, usually
# in /etc/apache2/sites-available:
#
# <VirtualHost *:80>
#         ServerAdmin webrender@gmail.com
#         ServerName local.webrender.net
#         ServerAlias *.local.webrender.net
#         ProxyPass / http://localhost:4567/
#         ProxyPassReverse / http://localhost:4567/
# </VirtualHost>
#
# You'll also need to configure a CNAME record for your subdomain.

ssh -R 4567:localhost:8000 webrender@webrender.net

