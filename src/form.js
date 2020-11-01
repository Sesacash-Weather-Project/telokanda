document.body.style.zoom="200%"

var $ = require("jquery");

import React from 'react'

const ENABLE_AFTER_MS = 45000;
//const ENABLE_AFTER_MS = 11*60*60*1000 // 11 hours

const { Api, JsonRpc, RpcError, Serialize } = require('eosjs');
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig');      // development only
const ecc = require('eosjs-ecc');

const fs = require('fs');
var _ = require('lodash');

// Init EOS api variables
const signatureProvider = new JsSignatureProvider(['XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX']);
//const rpc = new JsonRpc('https://basho-api.telosuk.io'); // Testnet
const rpc = new JsonRpc('https://telos.caleos.io'); // Mainnet
const api = new Api({ rpc, signatureProvider});

// Create random eosio name for launch id
let launchid;
// subset of characters allowed in eosio names
const characters = 'abcdefghijklmnopqrstuvwxyz12345';
// Twelve characters per account name
for (var i = 0; i < 12; i++) {
    launchid += characters.charAt(Math.floor(Math.random() * characters.length));
}

async function get_launch_number(state) {

    let json = await rpc.get_table_rows({
        json: true,                 // Get the response as json
        code: state.contract,           // Contract that we target
        scope: state.contract,          // Account that owns the data
        table: 'launches',          // Table name
        //lower_bound: 1,     // Table primary key value
        lower_bound: launchid,     // Table primary key value
        upper_bound: launchid,     // Table primary key value
        reverse: true,
        limit: 1,                   // Here we limit to 1 to get only the single row with primary key equal to 'testacc'
    });

    if (json.rows.length>0) {
        //return json.rows[0].launch_number;
        return true;
    } else {
        return false;
    }

}

async function submit_msig_proposal(state) {

    const WAIT_LIMIT_SEC = 45; // 45 seconds

    const info = await rpc.get_info();
    let trx = {};
    let tapos = {
        'blocksBehind': 3, 'expireSeconds': 5,
        'broadcast': true, 'sign': true
    };

    // Build msig contract with proposal name same as contract
    const contract = state.contract;

    try {

        let block_time = info.head_block_time;
        block_time = block_time.substring(0, block_time.indexOf('.')).concat('Z');
        const expir_unix_time = Date.parse(block_time)/1000 + WAIT_LIMIT_SEC; // Add 30 seconds to last block time
        const expirString = new Date(expir_unix_time*1000).toISOString().slice(0,-1); // Converts to ISO and slices off the 'Z'

        // Set nodeid which will also be our eosio primary index (name converts to uint64_t)


        // First set locked action websetlaunch
        let lockedActions = [{}];
        lockedActions[0].account = contract;
        lockedActions[0].name = 'websetlaunch';
        lockedActions[0].authorization = [{'actor': 'weatherapppp', 'permission': 'active'}];
        lockedActions[0].data = {};
        lockedActions[0].data.launch_id = launchid;
        lockedActions[0].data.unix_time = expir_unix_time;
        lockedActions[0].data.miner = state.miner;
        lockedActions[0].data.device_type = state.device_type;
        lockedActions[0].data.wxcondition = state.weather;

        console.log(lockedActions);

        const serialized_actions = await api.serializeActions(lockedActions);

        const proposeInput = {};
        proposeInput.proposer = 'weatherapppp';
        proposeInput.proposal_name = contract;
        proposeInput.requested = [{'actor': 'noderedtelos', 'permission': 'active'},
            {'actor': 'weatherapppp', 'permission': 'active'}];
        proposeInput.trx = {};
        proposeInput.trx.expiration = expirString;
        proposeInput.trx.ref_block_num = 0;
        proposeInput.trx.ref_block_prefix = 0;
        proposeInput.trx.max_net_usage_words = 0;
        proposeInput.trx.max_cpu_usage_ms = 0;
        proposeInput.trx.delay_sec = 0;
        proposeInput.trx.context_free_actions = [];
        proposeInput.trx.actions = serialized_actions;
        proposeInput.trx.transaction_extensions = [];

        trx.actions = [{}]; // {msig propose}
        // Create new proposal msig
        trx.actions[0].account = 'eosio.msig';
        trx.actions[0].name = 'propose';
        trx.actions[0].authorization = [{'actor': 'weatherapppp', 'permission': 'active'}];
        trx.actions[0].data = proposeInput;


        //console.log(trx);
        console.log("Proposing new msig contract");
        console.log(trx);
        await api.transact(trx, tapos);

        trx.actions = [{}]; // {msig approve}

        // Approve own proposal
        trx.actions[0].account = 'eosio.msig';
        trx.actions[0].name = 'approve';
        trx.actions[0].authorization = [{'actor': 'weatherapppp', 'permission': 'active'}];
        trx.actions[0].data = {'proposer':'weatherapppp',
            'proposal_name': contract,
            'level': {'actor': 'weatherapppp', 'permission': 'active'}};

        console.log("Approving msig contract");
        await api.transact(trx, tapos);

    } catch (e) {
        console.log(e);
    }

    // Begin counter to remove the proposal shortly after expiration
    setTimeout(() => {

        trx.actions = [{}]; // {msig approve}

        trx.actions[0].account = 'eosio.msig';
        trx.actions[0].name = 'cancel';
        trx.actions[0].authorization = [{'actor': 'weatherapppp', 'permission': 'active'}];
        trx.actions[0].data = {'proposer':'weatherapppp', 'proposal_name': contract, 'canceler': 'weatherapppp'};

        // Send cancel transaction
        console.log("Attempting to cancel old msig contract in case it exists");
        (async () => {
            await api.transact(trx, tapos);
        })();
    }, WAIT_LIMIT_SEC*1000);

}

export class Form extends React.Component {
    state = {
        contract: '',
        sesacash_memo: '',
        certified: false,
        next_to_gateway: false,
        launching_in_10_minutes: false,
        weather: '',
        last_launch: 0,
        error: '',
        disabled: false,
    }

    componentWillUnmount() {
        this.clearCountdown()
    }

    handleChange = e => {
        this.setState({[e.target.name]: e.target.value})
    }

    handleToggle = e => {
        const name = e.target.name
        this.setState(state => ({[name]: !state[name]}))
    }

    data = () => {
        const {
            contract,
            sesacash_memo,
            certified,
            next_to_gateway,
            launching_in_10_minutes,
            weather,
        } = this.state
        return {
            contract,
            sesacash_memo,
            certified,
            next_to_gateway,
            launching_in_10_minutes,
            weather,
        }
    };

    errorMessage = () => {
        const data = this.data()
        /*
          check data here, return an error message or nothing
         */
        return ''
    }

    startCountdown = () => {

        (async () => {
            //this.last_launch = await get_launch_number(this.state);
            this.ifLaunched = await get_launch_number(this.state);
        })();

        this.startTime = new Date();
        this.interval = setInterval(async () => {
            const elapsed = new Date() - this.startTime
            //console.log('time elapsed (ms)', elapsed)


            if (elapsed >= ENABLE_AFTER_MS) {
                $( "#blockchain_status" ).hide()
                $( "#launch_verified" ).hide()
                $( "#launch_failed" ).show()
                console.log("Enabling form.");
                this.clearCountdown();
                this.setState({disabled: false})
            }

            this.ifLaunched = await get_launch_number(this.state);
            //if (launch > this.last_launch) {
            if ( this.ifLaunched ) {
                console.log("Launch successfully added!");
                $( "#blockchain_status" ).hide()
                $( "#launch_failed" ).hide()
                $( "#launch_verified" ).show()
                console.log("Enabling form.");
                this.clearCountdown();
                this.setState({disabled: false})
            }

        }, 3000)
    }

    clearCountdown = () => {
        if (this.interval) {
            clearInterval(this.interval)
        }
    }

    submit = e => {

        launchid = '';
        // subset of characters allowed in eosio names
        const characters = 'abcdefghijklmnopqrstuvwxyz12345';
        // Twelve characters per account name
        for (var i = 0; i < 12; i++) {
            launchid += characters.charAt(Math.floor(Math.random() * characters.length));
        }

        e.preventDefault()
        const data = this.data()
        console.log('data to submit', data)
        const error = this.errorMessage()
        if (error) {
            console.log('data was invalid', error)
            this.setState({error})
        } else {
            submit_msig_proposal(this.state);
            /*
              send the data to the server here
             */
            this.setState({error: '', disabled: true})
            //console.log('waiting 11 hours...')
            this.startCountdown();
            $( "#launch_verified" ).hide()
            $( "#launch_failed" ).hide()
            $( "#blockchain_status" ).show()
        }
    };

    render() {
        return (
            <>
            <form onSubmit={this.submit} action="about:blank">
            <p>
            <label htmlFor="contract">Contract Account: </label>
        <input
        type="text"
        name="contract"
        id="contract"
        value={this.state.contract}
        onChange={this.handleChange}
        disabled={this.state.disabled}
        />
        </p>
        <p>
        <label htmlFor="miner">Telos Miner Account: </label>
        <input
        type="text"
        name="miner"
        id="miner"
        value={this.state.miner}
        onChange={this.handleChange}
        disabled={this.state.disabled}
        />
        </p>
        <p>
        <label htmlFor="device_type">Device Type: </label>
        <input
        type="text"
        name="device_type"
        id="device_type"
        value={this.state.device_type}
        onChange={this.handleChange}
        disabled={this.state.disabled}
        />
        </p>
        <p>Select current weather:</p>
        <p>
        <input
        type="radio"
        name="weather"
        value="sunny"
        id="sunny"
        checked={this.state.weather === 'sunny'}
        onChange={this.handleChange}
        />{' '}
        <label htmlFor="sunny">Sunny</label>
            <input
        type="radio"
        name="weather"
        value="partly_cloudy"
        id="partly_cloudy"
        checked={this.state.weather === 'partly_cloudy'}
        onChange={this.handleChange}
        />{' '}
        <label htmlFor="partly_cloudy">Partly cloudy</label>
        <input
        type="radio"
        name="weather"
        value="cloudy"
        id="cloudy"
        checked={this.state.weather === 'cloudy'}
        onChange={this.handleChange}
        />{' '}
        <label htmlFor="cloudy">Cloudy</label>
            <input
        type="radio"
        name="weather"
        value="unknown"
        id="unknown"
        checked={this.state.weather === 'unknown'}
        onChange={this.handleChange}
        />{' '}
        <label htmlFor="unknown">Can't tell</label>
        </p>
        <p>
        <input
        type="checkbox"
        name="certified"
        id="certified"
        checked={this.state.certified}
        onChange={this.handleToggle}
        />
        <label htmlFor="certified">I am a certified miner</label>
        </p>
        <p>
        <input
        type="checkbox"
        name="next_to_gateway"
        id="next_to_gateway"
        checked={this.state.next_to_gateway}
        onChange={this.handleToggle}
        />
        <label htmlFor="next_to_gateway">
            I am next to a gateway that works
        </label>
        </p>
        <p>
        <input
        type="checkbox"
        name="launching_in_10_minutes"
        id="launching_in_10_minutes"
        checked={this.state.launching_in_10_minutes}
        onChange={this.handleToggle}
        />
        <label htmlFor="launching_in_10_minutes">
            I will launch in the next 10 minutes
        </label>
        </p>
        <input
        type="submit"
        name="submit"
        value="Submit"
        disabled={this.state.disabled}
        />
        <p><strong>Note: After clicking Submit, wait 5 seconds and then plug in the battery to initiate the authentication.</strong></p>
        <p id="blockchain_status" style={{color: 'orange'}} hidden><strong>Waiting for blockchain to reflect changes...</strong></p>
        <p id="launch_verified" style={{color: 'green'}} hidden><strong>Verified for launch.</strong></p>
        <p id="launch_failed" style={{color: 'red'}} hidden><strong>Authentication failed. Try again.</strong></p>
        {this.state.error ? (
                <p style={{color: 'red'}}>{this.state.error}</p>
    ) : (
        <></>
    )}
    </form>
        </>
    )
    }
}
