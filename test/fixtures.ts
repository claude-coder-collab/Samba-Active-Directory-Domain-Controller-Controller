export const domainInfo = `Forest           : samdom.example.com
Domain           : samdom.example.com
Netbios domain   : SAMDOM
DC name          : dc1.samdom.example.com
DC netbios name  : DC1
Server site      : Default-First-Site-Name
Client site      : Default-First-Site-Name
`;

export const passwordPolicy = `Password information for domain 'DC=samdom,DC=example,DC=com'

Password complexity: on
Store plaintext passwords: off
Password history length: 24
Minimum password length: 7
Minimum password age (days): 1
Maximum password age (days): 42
Account lockout duration (mins): 30
Account lockout threshold (attempts): 0
Reset account lockout after (mins): 30
`;

export const userShow = (name: string, uac = 512): string => `dn: CN=${name} Smith,CN=Users,DC=samdom,DC=example,DC=com
objectClass: top
objectClass: person
objectClass: organizationalPerson
objectClass: user
cn: ${name} Smith
sn: Smith
givenName: ${name}
instanceType: 4
whenCreated: 20261118120000.0Z
displayName: ${name} Smith
name: ${name} Smith
objectGUID: 5e0b0c4b-1a2b-4c3d-9e8f-0123456789ab
userAccountControl: ${String(uac)}
objectSid: S-1-5-21-1-2-3-1104
sAMAccountName: ${name.toLowerCase()}
userPrincipalName: ${name.toLowerCase()}@samdom.example.com
memberOf: CN=Staff,CN=Users,DC=samdom,DC=example,DC=com
memberOf: CN=Sales,CN=Users,DC=samdom,DC=example,DC=com
description: A very long description that samba-tool folds across multiple
  lines because it is longer than the LDIF limit
distinguishedName: CN=${name} Smith,CN=Users,DC=samdom,DC=example,DC=com
`;
