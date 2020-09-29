import React from 'react'

const ENABLE_AFTER_MS = 20000;
//const ENABLE_AFTER_MS = 11*60*60*1000 // 11 hours

const { Api, JsonRpc, RpcError, Serialize } = require('eosjs');
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig');      // development only
const ecc = require('eosjs-ecc');

const fs = require('fs');
var _ = require('lodash');

// Init EOS api variables
const signatureProvider = new JsSignatureProvider(['XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX']);
const rpc = new JsonRpc('https://basho-api.telosuk.io');
const api = new Api({ rpc, signatureProvider});


async function submit_msig_proposal(state) {

  const WAIT_LIMIT_SEC = 30; // 30 seconds

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

    // First set locked actions "addminer" and "addsky"
    let lockedActions = [{}];
    lockedActions[0].account = contract;
    lockedActions[0].name = 'initlaunch';
    lockedActions[0].authorization = [{'actor': 'weatherapppp', 'permission': 'active'}];
    lockedActions[0].data = {};
    lockedActions[0].data.unix_time = expir_unix_time;

    //console.log(lockedActions);

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

    trx.actions = [{},{},{}]; // {setminer}, {setsky}, {msig propose}

    trx.actions[0].account = contract;
    trx.actions[0].name = 'setminer';
    trx.actions[0].authorization = [{'actor': 'weatherapppp', 'permission': 'active'}];
    trx.actions[0].data = {};
    trx.actions[0].data.miner = state.telos_miner_account;

    trx.actions[1].account = contract;
    trx.actions[1].name = 'setsky';
    trx.actions[1].authorization = [{'actor': 'weatherapppp', 'permission': 'active'}];
    trx.actions[1].data = {};
    trx.actions[1].data.wxcondition = state.weather;

    // Create new proposal msig
    trx.actions[2].account = 'eosio.msig';
    trx.actions[2].name = 'propose';
    trx.actions[2].authorization = [{'actor': 'weatherapppp', 'permission': 'active'}];
    trx.actions[2].data = proposeInput;


    //console.log(trx);
    console.log("Proposing new msig contract")
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
    telos_miner_account: '',
    certified: false,
    next_to_gateway: false,
    launching_in_10_minutes: false,
    weather: '',
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
      telos_miner_account,
      certified,
      next_to_gateway,
      launching_in_10_minutes,
      weather,
    } = this.state
    return {
      contract,
      telos_miner_account,
      certified,
      next_to_gateway,
      launching_in_10_minutes,
      weather,
    }
  }

  errorMessage = () => {
    const data = this.data()
    /*
      check data here, return an error message or nothing
     */
    return ''
  }

  startCountdown = () => {
    this.startTime = new Date()
    this.interval = setInterval(() => {
      const elapsed = new Date() - this.startTime
      //console.log('time elapsed (ms)', elapsed)
      if (elapsed >= ENABLE_AFTER_MS) {
        console.log('Enabling form')
        this.clearCountdown()
        this.setState({disabled: false})
      }
    }, 1000)
  }

  clearCountdown = () => {
    if (this.interval) {
      clearInterval(this.interval)
    }
  }

  submit = e => {
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
      console.log('waiting 11 hours...')
      this.startCountdown()
    }
  }

  render() {
    return (
      <>
        <iframe
          name="blankframe"
          style={{display: 'none'}}
          src="about:blank"></iframe>
        <form onSubmit={this.submit} action="about:blank">
          <p>
            <label htmlFor="contract">Device Account: </label>
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
            <label htmlFor="telos_miner_account">Telos Miner Account: </label>
            <input
              type="text"
              name="telos_miner_account"
              id="telos_miner_account"
              value={this.state.telos_miner_account}
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
