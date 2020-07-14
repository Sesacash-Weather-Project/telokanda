import React from 'react'
import {Row, Col} from 'react-simple-flex-grid'
import 'react-simple-flex-grid/lib/main.css'

import {Form} from './form'

export const App = () => (
  <Row>
    <Col span={1}>
      <img src="logo.jpg" alt="Logo" width="100px" />
    </Col>
    <Col span={11}>
      <Form />
    </Col>
  </Row>
)
