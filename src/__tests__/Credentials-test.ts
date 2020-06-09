import { Credentials, SimpleSigner } from '../index'
import { verifyJWT, decodeJWT } from 'did-jwt'
import { createPresentation, verifyCredential } from 'did-jwt-vc'
import { Issuer } from 'did-jwt-vc/lib/types'

import MockDate from 'mockdate'
import { DIDDocument, Resolver } from 'did-resolver'
import * as ethrResolver from 'ethr-did-resolver'
import * as webResolver from 'web-did-resolver'
import { AbiEntryType, ContractABI } from '../Contract'

jest.mock('ethr-did-resolver')

const NOW = 1485321133
MockDate.set(NOW * 1000)

const toSeconds = date => Math.floor(date / 1000)

const privateKey = '74894f8853f90e6e3d6dfdd343eb0eb70cca06e552ed8af80adadcc573b35da3'
const address = '0xbc3ae59bc76f894822622cdef7a2018dbe353840'
const did = `did:ethr:${address}`
const mnid = '2nQtiQG6Cgm1GYTBaaKAgr76uY7iSexUkqX'

const claim = {
  sub: '0x112233',
  claim: { email: 'bingbangbung@email.com' },
  exp: 1485321133 + 1
}

const uport = new Credentials({ privateKey, did })
const uport2 = new Credentials({})

interface DIDDocumentWithProfile extends DIDDocument {
  uportProfile?: object
}

function mockresolver(profile?: object) {
  const mockGetResolver = jest.spyOn(ethrResolver, 'getResolver')
  mockGetResolver.mockReturnValue({
    ethr: (id, parsed) => {
      const doc: DIDDocumentWithProfile = {
        '@context': 'https://w3id.org/did/v1',
        id,
        publicKey: [
          {
            id: `${id}#owner`,
            type: 'Secp256k1VerificationKey2018',
            owner: id,
            ethereumAddress: parsed.id
          }
        ],
        authentication: [
          {
            type: 'Secp256k1SignatureAuthentication2018',
            publicKey: `${id}#owner`
          }
        ]
      }
      if (profile) {
        doc.uportProfile = profile
      }
      return doc
    }
  })
}

describe('configuration', () => {
  describe('sets did', () => {
    describe('`did` configured', () => {
      expect(new Credentials({ did }).did).toEqual(did)
    })

    describe('ethereum `address` configured', () => {
      expect(new Credentials({ address }).did).toEqual(did)
    })

    describe('`privateKey` configured', () => {
      expect(new Credentials({ privateKey }).did).toEqual(did)
    })

    describe('mnid `address` configured', () => {
      expect(new Credentials({ address: mnid }).did).toEqual(`did:uport:${mnid}`)
    })
  })

  describe('sets signer', () => {
    describe('always uses signer if passed in', () => {
      const signer = SimpleSigner(privateKey)
      expect(new Credentials({ signer, privateKey }).signer).toEqual(signer)
    })

    describe('sets signer if privateKey is passed in', () => {
      expect(new Credentials({ privateKey }).signer).toBeDefined()
    })
  })

  describe('sets resolver', () => {
    describe('always uses resolver if passed in', () => {
      const web = webResolver.getResolver()
      const ethr = ethrResolver.getResolver()
      const resolver = new Resolver({ ...web, ...ethr })
      expect(new Credentials({ resolver }).resolver).toEqual(resolver)
    })
  })

  describe('configNetworks', () => {
    it('should accept a valid network setting', () => {
      const networks = {
        '0x94365e3b': {
          rpcUrl: 'https://private.chain/rpc',
          registry: '0x3b2631d8e15b145fd2bf99fc5f98346aecdc394c'
        }
      }
      expect(() => new Credentials({ networks })).not.toThrow()
    })
  })
})

describe('createIdentity()', () => {
  it('creates Identity', () => {
    const { did, privateKey } = Credentials.createIdentity()
    expect(did).toMatch(/^did:ethr:0x[0-9a-fA-F]{40}$/)
    expect(privateKey).toMatch(/^[0-9a-fA-F]{64}$/)
  })
})

describe('signJWT', () => {
  describe('uport method', () => {
    it('uses ES256K algorithm with address = mnid', async () => {
      const credentials = new Credentials({ address: mnid, privateKey })
      const jwt = await credentials.signJWT({ hello: 1 })
      const { header } = decodeJWT(jwt)
      expect(header.alg).toEqual('ES256K')
    })

    it('uses ES256K with did = mnid', async () => {
      const credentials = new Credentials({ did: mnid, privateKey })
      const jwt = await credentials.signJWT({ hello: 1 })
      const { header } = decodeJWT(jwt)
      expect(header.alg).toEqual('ES256K')
    })

    it('uses ES256K with did = did:uport:mnid', async () => {
      const credentials = new Credentials({
        did: `did:uport:${mnid}`,
        privateKey
      })
      const jwt = await credentials.signJWT({ hello: 1 })
      const { header } = decodeJWT(jwt)
      expect(header.alg).toEqual('ES256K')
    })
  })

  describe('ethr method', () => {
    it('uses ES256K-R algorithm', async () => {
      const credentials = new Credentials({ did, privateKey })
      const jwt = await credentials.signJWT({ hello: 1 })
      const { header } = decodeJWT(jwt)
      expect(header.alg).toEqual('ES256K-R')
    })
  })

  describe('validation', () => {
    it('should fail if no signer was configured', async () => {
      const badport = new Credentials({ did })
      return expect(badport.signJWT({ type: 'request' })).rejects.toThrow('No Signing Identity configured')
    })

    it('should fail if no did was configured', async () => {
      const badport = new Credentials({ signer: SimpleSigner(privateKey) })
      return expect(badport.signJWT({ type: 'request' })).rejects.toThrow('No Signing Identity configured')
    })
  })
})

describe('createDisclosureRequest()', () => {
  let credentials: Credentials
  beforeAll(() => mockresolver())
  beforeAll(() => {
    credentials = new Credentials({ privateKey, did })
  })
  async function createAndVerify(params = {}) {
    const jwt = await credentials.createDisclosureRequest(params)
    return await verifyJWT(jwt, { resolver: credentials.resolver })
  }

  it('creates a valid JWT for a request', async () => {
    const response = await createAndVerify({ requested: ['name', 'phone'] })
    return expect(response).toMatchSnapshot()
  })

  it('creates a valid JWT for a request with expiry', async () => {
    const response = await createAndVerify({ exp: NOW + 1000 })
    return expect(response).toMatchSnapshot()
  })

  it('has correct payload in JWT for a plain request for public details', async () => {
    const response = await createAndVerify()
    return expect(response).toMatchSnapshot()
  })

  it('has correct payload in JWT requesting a specific networkId', async () => {
    const response = await createAndVerify({ networkId: '0x4' })
    return expect(response).toMatchSnapshot()
  })

  describe('private chains', () => {
    it('has correct payload in JWT requesting a specific networkId with rpcUrl', async () => {
      const response = await createAndVerify({
        networkId: '0x64',
        rpcUrl: 'https://dai.poa.network/'
      })
      return expect(response).toMatchSnapshot()
    })

    it('missing network id', async () => {
      await expect(createAndVerify({ rpcUrl: 'https://dai.poa.network/' })).rejects.toMatchSnapshot()
    })
  })

  for (const accountType of ['general', 'segregated', 'keypair', 'none']) {
    it(`has correct payload in JWT requesting accountType of ${accountType}`, async () => {
      const response = await createAndVerify({ accountType })
      return expect(response).toMatchSnapshot()
    })
  }

  it(`has correct payload in JWT requesting unsupported accountType`, async () => {
    expect(createAndVerify({ accountType: 'gold' })).rejects.toMatchSnapshot()
  })

  it('ignores unsupported request parameters', async () => {
    const response = await createAndVerify({ signing: true, sellSoul: true })
    return expect(response).toMatchSnapshot()
  })

  it('includes vc in payload', async () => {
    expect(createAndVerify({ vc: ['woop'] })).toMatchSnapshot()
  })

  it('has correct payload in JWT for a request', async () => {
    const response = await createAndVerify({ requested: ['name', 'phone'] })
    return expect(response).toMatchSnapshot()
  })

  describe('specifying requested claims', () => {
    it('has correct payload in JWT for a request asking for verified credentials', async () => {
      const response = await createAndVerify({
        claims: {
          verifiable: {
            email: {
              iss: [
                {
                  did: 'did:web:uport.claims',
                  url: 'https://uport.claims/email'
                },
                {
                  did: 'did:web:sobol.io',
                  url: 'https://sobol.io/verify'
                }
              ],
              reason: 'Whe need to be able to email you'
            },
            nationalIdentity: {
              essential: true,
              iss: [
                {
                  did: 'did:web:idverifier.claims',
                  url: 'https://idverifier.example'
                }
              ],
              reason: 'To legally be able to open your account'
            }
          },
          user_info: {
            name: { essential: true, reason: 'Show your name to other users' },
            country: null
          }
        }
      })
      return expect(response).toMatchSnapshot()
    })
  })
  it('has correct payload in JWT for a request asking for verified credentials', async () => {
    const response = await createAndVerify({
      requested: ['name', 'phone'],
      verified: ['name']
    })
    return expect(response).toMatchSnapshot()
  })

  it('has correct payload in JWT for a request with callbackUrl', async () => {
    const response = await createAndVerify({
      requested: ['name', 'phone'],
      callbackUrl: 'https://myserver.com'
    })
    return expect(response).toMatchSnapshot()
  })

  it('has correct payload in JWT for a request for push notifications', async () => {
    const response = await createAndVerify({
      requested: ['name', 'phone'],
      notifications: true
    })
    return expect(response).toMatchSnapshot()
  })

  it('has correct payload in JWT for a request with boxPub', async () => {
    const response = await createAndVerify({
      boxPub: 'DummyPrivateKey'
    })
    return expect(response).toMatchSnapshot()
  })
})

describe('LEGACY createDisclosureRequest()', () => {
  let credentials: Credentials
  beforeAll(() => mockresolver())
  beforeAll(() => {
    credentials = new Credentials({ privateKey, did })
  })
  async function createAndVerify(params = {}) {
    const jwt = await credentials.createDisclosureRequest(params)
    return await verifyJWT(jwt, { resolver: credentials.resolver })
  }
  it('creates a valid JWT for a request', async () => {
    const response = await createAndVerify({ requested: ['name', 'phone'] })
    return expect(response).toMatchSnapshot()
  })
})

describe('disclose()', () => {
  let credentials: Credentials
  beforeAll(() => mockresolver())
  beforeAll(() => {
    credentials = new Credentials({ privateKey, did })
  })
  async function createAndVerify(params = {}) {
    const jwt = await credentials.createDisclosureResponse(params)
    return await verifyJWT(jwt, { resolver: credentials.resolver, audience: did })
  }

  it('creates a valid JWT for a disclosure', async () => {
    const response = await createAndVerify({ own: { name: 'Bob' } })
    return expect(response).toMatchSnapshot()
  })

  it('creates a valid JWT for a disclosure', async () => {
    const req = await credentials.createDisclosureRequest()
    const response = await createAndVerify({ req })
    return expect(response).toMatchSnapshot()
  })
})

describe('createVerificationSignatureRequest()', () => {
  let credentials: Credentials
  beforeAll(() => mockresolver())
  beforeAll(() => {
    credentials = new Credentials({ privateKey, did })
  })

  it('creates a valid JWT for a request', async () => {
    const jwt = await uport.createVerificationSignatureRequest(
      { claim: { test: { prop1: 1, prop2: 2 } } },
      { sub: 'did:uport:223ab45' }
    )
    return expect(await verifyJWT(jwt, { resolver: credentials.resolver, audience: did })).toMatchSnapshot()
  })

  it('allows setting an expiration for the requested credential', async () => {
    const fakeuport = new Credentials({ privateKey, did })
    const rexp = 1000
    const jwt = await uport.createVerificationSignatureRequest(
      { claim: { test: 'test' } },
      { sub: 'did:ethr:0x1', rexp }
    )
    const { payload } = decodeJWT(jwt)
    return expect(payload.rexp).toEqual(rexp)
  })

  it('allows setting an expiration for the request message', async () => {
    const fakeuport = new Credentials({ privateKey, did })
    const expiresIn = 1000
    const jwt = await uport.createVerificationSignatureRequest(
      { claim: { test: 'test' } },
      { sub: 'did:ethr:0x1', expiresIn }
    )
    const { payload } = decodeJWT(jwt)
    return expect(payload.exp).toEqual(NOW + expiresIn)
  })
})

describe('createTypedDataSignatureRequest()', () => {
  const typedData = {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
        { name: 'salt', type: 'bytes32' }
      ],
      Greeting: [
        { name: 'text', type: 'string' },
        { name: 'subject', type: 'string' }
      ]
    },
    domain: {
      name: 'My dapp',
      version: '1.0',
      chainId: 1,
      verifyingContract: '0xdeadbeef',
      salt: '0x999999999910101010101010'
    },
    primaryType: 'Greeting',
    message: {
      text: 'Hello',
      subject: 'World'
    }
  }

  it('creates a valid JWT for a typed data request', async () => {
    const jwt = await uport.createTypedDataSignatureRequest(typedData, {
      from: '0xdeadbeef',
      net: '0x1'
    })
    expect(jwt).toMatchSnapshot()
  })

  describe('missing data', () => {
    ;['types', 'primaryType', 'domain', 'message'].forEach(prop => {
      it(`should require ${prop}`, async () => {
        const broken = { ...typedData }
        delete broken[prop]
        return expect(
          uport.createTypedDataSignatureRequest(broken, {
            from: '0xdeadbeef',
            net: '0x1'
          })
        ).rejects.toThrow(`Invalid EIP712 Request, must include '${prop}'`)
      })
    })
  })
})

describe('createPersonalSignRequest()', () => {
  it('creates a valid JWT for a personal sign request', async () => {
    const did = '0xdeadbeef'
    const data = '0xdeadbeef'
    const jwt = await uport.createPersonalSignRequest(data, {
      from: did,
      net: '0x1'
    })
    expect(jwt).toMatchSnapshot()
    const { data: decodedData, from, net, type }: any = decodeJWT(jwt).payload
    expect(decodedData).toEqual(data)
    expect(from).toEqual(did)
    expect(net).toEqual('0x1')
    expect(type).toEqual('personalSigReq')
  })
})

describe('createVerification()', () => {
  let credentials: Credentials
  beforeAll(() => mockresolver())
  beforeAll(() => {
    credentials = new Credentials({ privateKey, did })
  })
  it('has correct payload in JWT for an attestation', async () => {
    return credentials
      .createVerification({
        sub: 'did:uport:223ab45',
        claim: { email: 'bingbangbung@email.com' },
        exp: 1485321133 + 1
      })
      .then(async jwt => {
        const decoded = await verifyJWT(jwt, { resolver: credentials.resolver })
        return expect(decoded).toMatchSnapshot()
      })
  })
})

describe('authenticateDisclosureResponse()', () => {
  let credentials: Credentials
  beforeAll(() =>
    mockresolver({
      name: 'Super Developer',
      country: 'NI'
    })
  )
  beforeAll(() => {
    credentials = new Credentials({ privateKey, did })
  })
  async function createShareResp(payload = {}) {
    const req = await credentials.createDisclosureRequest({
      requested: ['name', 'phone']
    })
    return credentials.createDisclosureResponse({ ...payload, req })
  }

  async function createShareRespWithVerifiedCredential(payload = {}) {
    const req = await credentials.createDisclosureRequest({
      requested: ['name', 'phone']
    })
    const attestation = await credentials.createVerification(claim)
    return credentials.createDisclosureResponse({
      ...payload,
      verified: [attestation],
      req
    })
  }

  it('returns profile mixing public and private claims', async () => {
    const jwt = await createShareResp({
      own: { name: 'Davie', phone: '+15555551234' }
    })
    const profile = await credentials.authenticateDisclosureResponse(jwt)
    expect(profile).toMatchSnapshot()
  })

  it('returns profile mixing public and private claims and verified credentials', async () => {
    const jwt = await createShareRespWithVerifiedCredential({
      own: { name: 'Davie', phone: '+15555551234' }
    })
    const profile = await credentials.authenticateDisclosureResponse(jwt)
    expect(profile).toMatchSnapshot()
  })

  it('returns profile with only public claims', async () => {
    const jwt = await createShareResp()
    const profile = await credentials.authenticateDisclosureResponse(jwt)
    expect(profile).toMatchSnapshot()
  })

  it('returns profile with private chain network id claims', async () => {
    const jwt = await createShareResp({
      nad: '34wjsxwvduano7NFC8ujNJnFjbacgYeWA8m'
    })
    const profile = await credentials.authenticateDisclosureResponse(jwt)
    expect(profile).toMatchSnapshot()
  })

  it('returns pushToken if available', async () => {
    const jwt = await createShareResp({ capabilities: ['PUSHTOKEN'] })
    const profile = await credentials.authenticateDisclosureResponse(jwt)
    expect(profile).toMatchSnapshot()
  })

  describe('check original request', () => {
    it('rejects response with missing challenge', async () => {
      const jwt = await credentials.createDisclosureResponse({ own: { name: 'bob' } })
      expect(credentials.authenticateDisclosureResponse(jwt)).rejects.toThrow('Challenge was not included in response')
    })

    it('should reject if embedded request was not from me', async () => {
      const id = Credentials.createIdentity()
      const badPort = new Credentials(id)
      const req = await badPort.createDisclosureRequest({
        requested: ['name', 'phone']
      })
      const jwt = await credentials.createDisclosureResponse({
        own: { name: 'Davie', phone: '+15555551234' },
        req
      })
      return expect(credentials.authenticateDisclosureResponse(jwt)).rejects.toThrow(
        `JWT audience does not match your DID: aud: ${id.did} !== yours: ${credentials.did}`
      )
    })

    it('should reject if wrong request type', async () => {
      const req = await credentials.createVerification({
        sub: '0x01234',
        claim: { name: 'Bob' }
      })
      const jwt = await credentials.createDisclosureResponse({
        own: { name: 'Davie', phone: '+15555551234' },
        req
      })
      return expect(credentials.authenticateDisclosureResponse(jwt)).rejects.toThrow(`Challenge payload type invalid: `)
    })
  })
})

describe('verifyDisclosure()', () => {
  let credentials: Credentials
  beforeAll(() =>
    mockresolver({
      name: 'Bob Smith',
      country: 'NI'
    })
  )
  beforeAll(() => {
    credentials = new Credentials({ privateKey, did })
  })

  it('returns profile mixing public and private claims', async () => {
    const jwt = await credentials.createDisclosureResponse({
      own: { name: 'Davie', phone: '+15555551234' }
    })
    const profile = await credentials.verifyDisclosure(jwt)
    expect(profile).toMatchSnapshot()
  })

  it('returns profile mixing public and private claims and verified credentials', async () => {
    const attestation = await credentials.createVerification(claim)
    const jwt = await credentials.createDisclosureResponse({
      own: { name: 'Davie', phone: '+15555551234' },
      verified: [attestation]
    })
    const profile = await credentials.verifyDisclosure(jwt)
    expect(profile).toMatchSnapshot()
  })

  it('returns profile with only public claims', async () => {
    const jwt = await credentials.createDisclosureResponse()
    const profile = await credentials.verifyDisclosure(jwt)
    expect(profile).toMatchSnapshot()
  })

  it('returns profile with private chain network id claims', async () => {
    const jwt = await credentials.createDisclosureResponse({
      nad: '34wjsxwvduano7NFC8ujNJnFjbacgYeWA8m'
    })
    const profile = await credentials.verifyDisclosure(jwt)
    expect(profile).toMatchSnapshot()
  })

  it('returns pushToken if available', async () => {
    const jwt = await credentials.createDisclosureResponse({
      capabilities: ['PUSHTOKEN']
    })
    const profile = await credentials.verifyDisclosure(jwt)
    expect(profile).toMatchSnapshot()
  })

  it('declines to verify invalid jwts without crashing', async () => {
    const goodjwt = await credentials.createVerification(claim)
    const badjwt = 'not.a.jwt'

    const response = await credentials.createDisclosureResponse({
      verified: [goodjwt, badjwt]
    })
    const profile = await credentials.verifyDisclosure(response)

    expect(profile.verified.length).toEqual(1)
    expect(profile.invalid.length).toEqual(1)
    expect(response).toMatchSnapshot()
  })
})

describe('txRequest()', () => {
  let credentials: Credentials
  mockresolver()
  credentials = new Credentials({ privateKey, did })
  const abi: ContractABI = [
    {
      constant: false,
      inputs: [{ name: 'status', type: 'string' }],
      name: 'updateStatus',
      outputs: [],
      payable: false,
      type: AbiEntryType.Function
    },
    {
      constant: false,
      inputs: [{ name: 'addr', type: 'address' }],
      name: 'getStatus',
      outputs: [{ name: '', type: 'string' }],
      payable: false,
      type: AbiEntryType.Function
    }
  ]
  const address = '0x70A804cCE17149deB6030039798701a38667ca3B'
  const statusContract: any = credentials.contract(abi).at(address)

  it('creates a valid JWT for a request', async () => {
    const jwt = await statusContract.updateStatus('hello')
    const verified = await verifyJWT(jwt, { resolver: credentials.resolver })
    expect(verified.payload).toMatchSnapshot()
  })

  it('encodes readable function calls including given args in function key of jwt', async () => {
    const jwt = await statusContract.updateStatus('hello')
    const verified = await verifyJWT(jwt, { resolver: credentials.resolver })
    expect(verified.payload.fn).toEqual('updateStatus(string "hello")')
  })

  it('adds to key as contract address to jwt', async () => {
    const jwt = await statusContract.updateStatus('hello')
    const verified = await verifyJWT(jwt, { resolver: credentials.resolver })
    expect(verified.payload.to).toEqual(address)
  })

  it('adds additional request options passed to jwt', async () => {
    const networkId = '0x4'
    const callbackUrl = 'mydomain'
    const jwt = await statusContract.updateStatus('hello', {
      networkId,
      callbackUrl,
      label: 'Update Status'
    })
    const verified = await verifyJWT(jwt, { resolver: credentials.resolver })
    expect(verified.payload.net).toEqual(networkId)
    expect(verified.payload.callback).toEqual(callbackUrl)
    expect(verified.payload.label).toEqual('Update Status')
  })
})

describe('issueVerifiableCredential', () => {
  let credentials: Credentials

  const vcPayload: any = {
    sub: 'did:ethr:0x435df3eda57154cf8cf7926079881f2912f54db4',
    nbf: Date.now() / 1000,
    vc: {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiableCredential'],
      credentialSubject: {
        degree: {
          type: 'BachelorDegree',
          name: 'Baccalauréat en musiques numériques'
        }
      }
    }
  }
  it('vc test', async () => {
    credentials = new Credentials({ privateKey, did })
    const jwt = await credentials.issueVerifiableCredential(vcPayload)
    const decoded = await verifyCredential(jwt, credentials.resolver)
    expect(decoded.payload.vc).toEqual(vcPayload.vc)
  })

  it('Throws error if no signer configured', async () => {
    credentials = new Credentials({})
    expect(credentials.issueVerifiableCredential(vcPayload)).rejects.toThrow('No Signing Identity configured')
  })
})

describe('verifyPresentation', () => {
  let credentials: Credentials

  const vcPayload: any = {
    sub: 'did:ethr:0x435df3eda57154cf8cf7926079881f2912f54db4',
    nbf: 1562950282,
    vc: {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiableCredential'],
      credentialSubject: {
        degree: {
          type: 'BachelorDegree',
          name: 'Baccalauréat en musiques numériques'
        }
      }
    }
  }

  it('verifyPresentation', async () => {
    credentials = new Credentials({ privateKey, did })
    const vcJwt = await credentials.issueVerifiableCredential(vcPayload)

    const vpPayload: any = {
      vp: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential'],
        verifiableCredential: [vcJwt]
      }
    }

    const issuer: Issuer = { did: credentials.did, signer: credentials.signer }
    const vpJwt = await createPresentation(vpPayload, issuer)

    const result = await credentials.verifyPresentation(vpJwt)
    expect(result.payload.iss).toEqual(issuer.did)
    expect(result.payload.vp).toEqual(vpPayload.vp)
    expect(result.payload.vp.verifiableCredential).toEqual(vpPayload.vp.verifiableCredential)
  })
})
