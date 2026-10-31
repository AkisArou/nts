// Regression guard: discard flow authority after an incomplete fixpoint.
// Fix: b1e2d851748d1b06112c0bc95462d483545125cd.
// run: check
// Subject and control differ in the number of nested joins: seventy versus eight.
function deep(mask: string): number {
  let result = 0;
  if (mask.charCodeAt(0) === 49) {
    if (mask.charCodeAt(1) === 49) {
      if (mask.charCodeAt(2) === 49) {
        if (mask.charCodeAt(3) === 49) {
          if (mask.charCodeAt(4) === 49) {
            if (mask.charCodeAt(5) === 49) {
              if (mask.charCodeAt(6) === 49) {
                if (mask.charCodeAt(7) === 49) {
                  if (mask.charCodeAt(8) === 49) {
                    if (mask.charCodeAt(9) === 49) {
                      if (mask.charCodeAt(10) === 49) {
                        if (mask.charCodeAt(11) === 49) {
                          if (mask.charCodeAt(12) === 49) {
                            if (mask.charCodeAt(13) === 49) {
                              if (mask.charCodeAt(14) === 49) {
                                if (mask.charCodeAt(15) === 49) {
                                  if (mask.charCodeAt(16) === 49) {
                                    if (mask.charCodeAt(17) === 49) {
                                      if (mask.charCodeAt(18) === 49) {
                                        if (mask.charCodeAt(19) === 49) {
                                          if (mask.charCodeAt(20) === 49) {
                                            if (mask.charCodeAt(21) === 49) {
                                              if (mask.charCodeAt(22) === 49) {
                                                if (mask.charCodeAt(23) === 49) {
                                                  if (mask.charCodeAt(24) === 49) {
                                                    if (mask.charCodeAt(25) === 49) {
                                                      if (mask.charCodeAt(26) === 49) {
                                                        if (mask.charCodeAt(27) === 49) {
                                                          if (mask.charCodeAt(28) === 49) {
                                                            if (mask.charCodeAt(29) === 49) {
                                                              if (mask.charCodeAt(30) === 49) {
                                                                if (mask.charCodeAt(31) === 49) {
                                                                  if (mask.charCodeAt(32) === 49) {
                                                                    if (mask.charCodeAt(33) === 49) {
                                                                      if (mask.charCodeAt(34) === 49) {
                                                                        if (mask.charCodeAt(35) === 49) {
                                                                          if (mask.charCodeAt(36) === 49) {
                                                                            if (mask.charCodeAt(37) === 49) {
                                                                              if (mask.charCodeAt(38) === 49) {
                                                                                if (mask.charCodeAt(39) === 49) {
                                                                                  if (mask.charCodeAt(40) === 49) {
                                                                                    if (mask.charCodeAt(41) === 49) {
                                                                                      if (mask.charCodeAt(42) === 49) {
                                                                                        if (mask.charCodeAt(43) === 49) {
                                                                                          if (mask.charCodeAt(44) === 49) {
                                                                                            if (mask.charCodeAt(45) === 49) {
                                                                                              if (mask.charCodeAt(46) === 49) {
                                                                                                if (mask.charCodeAt(47) === 49) {
                                                                                                  if (mask.charCodeAt(48) === 49) {
                                                                                                    if (mask.charCodeAt(49) === 49) {
                                                                                                      if (mask.charCodeAt(50) === 49) {
                                                                                                        if (mask.charCodeAt(51) === 49) {
                                                                                                          if (mask.charCodeAt(52) === 49) {
                                                                                                            if (mask.charCodeAt(53) === 49) {
                                                                                                              if (mask.charCodeAt(54) === 49) {
                                                                                                                if (mask.charCodeAt(55) === 49) {
                                                                                                                  if (mask.charCodeAt(56) === 49) {
                                                                                                                    if (mask.charCodeAt(57) === 49) {
                                                                                                                      if (mask.charCodeAt(58) === 49) {
                                                                                                                        if (mask.charCodeAt(59) === 49) {
                                                                                                                          if (mask.charCodeAt(60) === 49) {
                                                                                                                            if (mask.charCodeAt(61) === 49) {
                                                                                                                              if (mask.charCodeAt(62) === 49) {
                                                                                                                                if (mask.charCodeAt(63) === 49) {
                                                                                                                                  if (mask.charCodeAt(64) === 49) {
                                                                                                                                    if (mask.charCodeAt(65) === 49) {
                                                                                                                                      if (mask.charCodeAt(66) === 49) {
                                                                                                                                        if (mask.charCodeAt(67) === 49) {
                                                                                                                                          if (mask.charCodeAt(68) === 49) {
                                                                                                                                            if (mask.charCodeAt(69) === 49) {
                                                                                                                                              result = 1;
                                                                                                                                            }
                                                                                                                                          }
                                                                                                                                        }
                                                                                                                                      }
                                                                                                                                    }
                                                                                                                                  }
                                                                                                                                }
                                                                                                                              }
                                                                                                                            }
                                                                                                                          }
                                                                                                                        }
                                                                                                                      }
                                                                                                                    }
                                                                                                                  }
                                                                                                                }
                                                                                                              }
                                                                                                            }
                                                                                                          }
                                                                                                        }
                                                                                                      }
                                                                                                    }
                                                                                                  }
                                                                                                }
                                                                                              }
                                                                                            }
                                                                                          }
                                                                                        }
                                                                                      }
                                                                                    }
                                                                                  }
                                                                                }
                                                                              }
                                                                            }
                                                                          }
                                                                        }
                                                                      }
                                                                    }
                                                                  }
                                                                }
                                                              }
                                                            }
                                                          }
                                                        }
                                                      }
                                                    }
                                                  }
                                                }
                                              }
                                            }
                                          }
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  return result + 17;
}
export function subject(flag: boolean): number { return deep(flag ? "1111111111111111111111111111111111111111111111111111111111111111111111" : "0000000000000000000000000000000000000000000000000000000000000000000000"); }

function shallow(mask: string): number {
  let result = 0;
  if (mask.charCodeAt(0) === 49) {
    if (mask.charCodeAt(1) === 49) {
      if (mask.charCodeAt(2) === 49) {
        if (mask.charCodeAt(3) === 49) {
          if (mask.charCodeAt(4) === 49) {
            if (mask.charCodeAt(5) === 49) {
              if (mask.charCodeAt(6) === 49) {
                if (mask.charCodeAt(7) === 49) {
                  result = 1;
                }
              }
            }
          }
        }
      }
    }
  }
  return result + 17;
}
export function control(flag: boolean): number { return shallow(flag ? "11111111" : "00000000"); }
