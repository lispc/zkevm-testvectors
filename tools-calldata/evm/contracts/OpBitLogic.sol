// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

contract OpBitLogic {

    uint256 public ret;

    // opcode 0x16
    function opAnd() public {
        assembly {
            let result := and(2,10) // 0010 & 1010 = 0010
            sstore(0x0, result)
        }
    }

    // opcode 0x17
    function opOr() public {
        assembly {
            let result := or(2,10) // 0010 | 1010 = 1010
            sstore(0x0, result)
        }
    }

    // opcode 0x18
    function opXor() public {
        assembly {
            let result := xor(2,10) // 0010 xor 1010 = 1000
            sstore(0x0, result)
        }
    }
    // opcode 0x19
    function opNot() public {
        assembly {
            let result := not(2) // 00...0010 not = 111..1101 = 0xff...fffd
            sstore(0x0, result)
        }
    }
    // opcode 0x1a
    function opByte() public {
        assembly {
            let result := byte(1,0x0123456789012345678901234567890123456789012345678901234567890123) //offset 1 --> 0x23
            sstore(0x0, result)
        }
    }

    // opcode 0x1b
    function opShl() public {
        assembly {
            let result := shl(8, 1) // 1 << 8 = 1 0000 0000
            sstore(0x0, result)
        }
    }

    function opShlBig() public {
        assembly {
            let result := shl(260, 1) // 1 << 8 = 1 0000 0000
            sstore(0x0, result)
        }
    }

    // opcode 0x1c
    function opShr() public {
        assembly {
            let result := shr(8, 0x100) // 0001 0000 0000 >> 8 = 1
            sstore(0x0, result)
        }
    }

    function opShrBig() public {
        assembly {
            let result := shr(10, 0x100) // 0001 0000 0000 >> 8 = 1
            sstore(0x0, result)
        }
    }

    // opcode 0x1d (?)
    function opSar() public {
        assembly {
            let result := sar(8, 0x100) // 0001 0000 0000 >> 8 = 1
            sstore(0x0, result)
        }
    }
}