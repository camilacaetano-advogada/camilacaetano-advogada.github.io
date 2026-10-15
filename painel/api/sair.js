'use strict';
const { cookieLimpo } = require('./_lib');

module.exports = (req, res) => {
  res.setHeader('Set-Cookie', cookieLimpo());
  res.status(200).json({ ok: true });
};
