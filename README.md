# blackboard_downloader

Handy tool that will allow you to download all or some selected files from courses on the Blackboard Learn system.

I've personally tested this out for GWU's implementation of Blackboard, but this should work out of the box on other implementations.

## Setup

This is a Node.js script, so you should consider [downloading Node](http://nodejs.org/) before attempting to run it.

To download the repo, simply clone it:

	git clone https://github.com/pratheekrebala/blackboard_downloader.git
	cd blackboard_downloader

Then install the dependencies:

	npm install
  
Then update the `blackboard_url` in `index.js`

Then run the script using `node index.js` and follow the command prompt.

If you have any issues - shoot me an email at `pratheekrebala@gmail.com` or open an Issue/PR.
